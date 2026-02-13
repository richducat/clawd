#!/usr/bin/env node
/**
 * TYFYS RingCentral Inbound SMS Forwarder → Lead Owner line
 *
 * Goal:
 * - Scan inbound SMS across sales-team lines.
 * - For each inbound client text, look up the Zoho Lead by phone/mobile.
 * - If Lead.Owner is Adam/Amy/Jared and the inbound text did NOT arrive on that rep's line,
 *   forward the message to the rep's RingCentral line.
 *
 * Safety:
 * - Idempotent: stores processed message ids in a state file.
 * - Loop prevention: forwarded messages are outbound from our lines and won't be re-forwarded.
 * - Does NOT auto-reply to the client; it only forwards internally.
 *
 * Usage:
 *   node scripts/tyfys/ringcentral-inbound-sms-forward-to-owner.mjs --dry-run
 *   node scripts/tyfys/ringcentral-inbound-sms-forward-to-owner.mjs --send
 *
 * Options:
 *   --tenant new|old  (default: new)
 *   --lookbackMin 30 (default: 35)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql } from '../lib/zoho.mjs';
import { ringcentralGetJson, ringcentralSendSms } from '../lib/ringcentral.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

const send = process.argv.includes('--send');
const dryRun = process.argv.includes('--dry-run') || !send;

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const tenant = getArg('--tenant', 'new');
const lookbackMin = Number(getArg('--lookbackMin', '35'));

const STATE_PATH = path.resolve('memory/tyfys-ringcentral-inbound-sms-forwarder.json');

// Source of truth: reps we forward to.
// NOTE: Jared is intentionally disabled for now (token/extension mismatch).
const REP_LINE_BY_OWNER = {
  Adam: '+14072168511',
  Amy: '+13212349530',
};

function normalizePhone(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.startsWith('+')) return s;
  const digits = s.replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return s;
}

function escZoho(s) {
  return String(s || '').replace(/'/g, "\\'");
}

async function readJson(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(p, obj) {
  if (dryRun) return;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function findLeadOwnerByPhone({ accessToken, apiDomain, phone }) {
  const p = normalizePhone(phone);
  if (!p) return null;

  // Try both Phone and Mobile.
  const q = `select id, Owner from Leads where (Phone = '${escZoho(p)}' or Mobile = '${escZoho(p)}') limit 5`;
  const res = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: q });
  const leads = res?.data || [];
  if (!leads.length) return null;

  const ownerName = leads[0]?.Owner?.name;
  return ownerName ? String(ownerName) : null;
}

function fmtForward({ ownerName, clientNumber, originalLine, createdAt, text }) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const when = createdAt ? new Date(createdAt).toLocaleString('en-US') : '';
  return `Inbound text for ${ownerName}\nFrom: ${clientNumber}\nReceived on: ${originalLine}${when ? `\nWhen: ${when}` : ''}\n\n${t}`;
}

async function main() {
  const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
  const zohoToken = await getZohoAccessToken();

  const state = await readJson(STATE_PATH, { processed: {}, lastRunAt: null });

  const now = new Date();
  const from = new Date(now.getTime() - lookbackMin * 60 * 1000);
  const dateFrom = from.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const dateTo = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  // For each rep extension, pull inbound SMS.
  const extRes = await ringcentralGetJson('/restapi/v1.0/account/~/extension?perPage=200', { tenant });
  const exts = extRes?.records || [];

  function extName(e) {
    const n = `${e?.contact?.firstName || ''} ${e?.contact?.lastName || ''}`.trim();
    return n || String(e?.name || '').trim();
  }

  const repExts = exts.filter(e => {
    const n = extName(e).toLowerCase();
    // Jared intentionally excluded for now.
    return n.includes('adam') || n.includes('amy');
  });

  let scanned = 0;
  let forwarded = 0;
  let skippedNoLead = 0;
  let skippedOwnerNotSales = 0;
  let skippedAlready = 0;
  let skippedSameLine = 0;

  for (const ext of repExts) {
    const qs = `/restapi/v1.0/account/~/extension/${ext.id}/message-store?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}&perPage=1000`;
    const msgStore = await ringcentralGetJson(qs, { tenant });
    const recs = (msgStore?.records || []).filter(r => r.type === 'SMS' && r.direction === 'Inbound');

    for (const r of recs) {
      scanned += 1;
      const msgId = String(r.id || '');
      if (msgId && state.processed[msgId]) {
        skippedAlready += 1;
        continue;
      }

      const clientNumber = normalizePhone(r.from?.phoneNumber || r.from?.name);
      const originalLine = normalizePhone(r.to?.[0]?.phoneNumber || r.to?.[0]?.name);
      const text = r.subject || '';

      const ownerName = await findLeadOwnerByPhone({ accessToken: zohoToken, apiDomain, phone: clientNumber });
      if (!ownerName) {
        skippedNoLead += 1;
        if (msgId) state.processed[msgId] = { at: new Date().toISOString(), reason: 'no_lead', from: clientNumber, line: originalLine };
        continue;
      }

      // Map Zoho owner name → rep key.
      // Jared is disabled; if the owner appears to be Jared, skip instead of blocking the run.
      if (ownerName.toLowerCase().includes('jared')) {
        skippedOwnerNotSales += 1;
        if (msgId) state.processed[msgId] = { at: new Date().toISOString(), reason: 'owner_jared_disabled', ownerName, from: clientNumber, line: originalLine };
        continue;
      }

      const repKey = Object.keys(REP_LINE_BY_OWNER).find(k => ownerName.toLowerCase().includes(k.toLowerCase()));
      if (!repKey) {
        skippedOwnerNotSales += 1;
        if (msgId) state.processed[msgId] = { at: new Date().toISOString(), reason: 'owner_not_sales', ownerName, from: clientNumber, line: originalLine };
        continue;
      }

      const repLine = REP_LINE_BY_OWNER[repKey];
      if (normalizePhone(repLine) === normalizePhone(originalLine)) {
        skippedSameLine += 1;
        if (msgId) state.processed[msgId] = { at: new Date().toISOString(), reason: 'already_on_owner_line', ownerName, from: clientNumber, line: originalLine };
        continue;
      }

      const fwd = fmtForward({ ownerName: repKey, clientNumber, originalLine, createdAt: r.creationTime, text });

      if (dryRun) {
        process.stdout.write(`[dry-run] forward to ${repKey} (${repLine}) from ${clientNumber} (received on ${originalLine})\n`);
      } else {
        await ringcentralSendSms({ fromNumber: repLine, toNumber: repLine, text: fwd, tenant });
        forwarded += 1;
      }

      if (msgId) state.processed[msgId] = { at: new Date().toISOString(), reason: 'forwarded', ownerName, to: repLine, from: clientNumber, line: originalLine };
    }
  }

  state.lastRunAt = new Date().toISOString();
  await writeJson(STATE_PATH, state);

  process.stdout.write(
    `Done. dryRun=${dryRun} tenant=${tenant} scanned=${scanned} forwarded=${forwarded} skipped_no_lead=${skippedNoLead} skipped_owner_not_sales=${skippedOwnerNotSales} skipped_same_line=${skippedSameLine} skipped_already=${skippedAlready}\n`,
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
