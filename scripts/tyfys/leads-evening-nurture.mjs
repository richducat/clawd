#!/usr/bin/env node
/**
 * TYFYS Lead Nurture (Evening kickoff)
 *
 * Sends the "Day 1 – SMS Evening" template (from the TYFYS Days 1–25 doc)
 * to leads owned by Adam/Amy/Jared who have not had activity in >=7 days.
 *
 * - SMS only
 * - Always appends booking link line
 * - Uses rep's RingCentral line as sender
 * - State file prevents re-sending the same kickoff to the same lead.
 *
 * Usage:
 *   node scripts/tyfys/leads-evening-nurture.mjs --dry-run [--tenant new]
 *   node scripts/tyfys/leads-evening-nurture.mjs --limit 200 --tenant new
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmGet } from '../lib/zoho.mjs';
import { ringcentralRefreshToken } from '../lib/ringcentral.mjs';

loadEnvLocal();

// Avoid crashing when piping to `head` / closed stdout.
process.stdout.on('error', () => {});

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const dryRun = process.argv.includes('--dry-run');
const tenant = getArg('--tenant', 'new');
const limit = Number(getArg('--limit', '250'));

const STATE_PATH = path.resolve('memory/tyfys-lead-nurture.json');
const DOC_EXPORT_URL = 'https://docs.google.com/document/d/1g2hC0qzFcAPjkawu4ArAAjlgsq1Rg8_ue7L-mN8UA6w/export?format=txt';
const BOOKING_LINE = 'Book here if easier: zbooking.us/hh8dC';

const REP_LINES = {
  // Provided by Richard
  'Adam Ayotte': '+14072168511',
  'Amy Cagle': '+13212349530',
  'Jared Maxwell': '+16822675268',
};

function tokenKey(userKey) {
  return tenant ? `${tenant}:${userKey}` : userKey;
}

const TOKENS_PATH = path.resolve('memory/ringcentral-refresh-tokens.json');

async function readTokens() {
  try {
    return JSON.parse(await fs.readFile(TOKENS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function writeTokens(obj) {
  await fs.mkdir(path.dirname(TOKENS_PATH), { recursive: true });
  await fs.writeFile(TOKENS_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function loadRepRefreshTokens() {
  // Stored locally (not in git) at memory/ringcentral-refresh-tokens.json
  const j = await readTokens();
  return {
    tokens: j,
    repTokens: {
      'Adam Ayotte': j[tokenKey('adam')],
      'Amy Cagle': j[tokenKey('amy')],
      'Jared Maxwell': j[tokenKey('jared')],
    },
  };
}

async function ringcentralSendSmsViaRefreshToken({ tokens, repKey, refreshToken, fromNumber, toNumber, text }) {
  const apiServer = process.env[(tenant ? `RINGCENTRAL_${tenant.toUpperCase()}_API_SERVER` : '')] || process.env.RINGCENTRAL_API_SERVER || 'https://platform.ringcentral.com';
  const refreshed = await ringcentralRefreshToken({ refreshToken, tenant });

  // RingCentral rotates refresh tokens; persist the newest token so the next run doesn't break.
  if (refreshed?.refresh_token && refreshed.refresh_token !== refreshToken) {
    tokens[tokenKey(repKey)] = refreshed.refresh_token;
    await writeTokens(tokens);
  }

  const accessToken = refreshed?.access_token;
  if (!accessToken) throw new Error('RingCentral refresh did not return access_token');

  const url = `${apiServer}/restapi/v1.0/account/~/extension/~/sms`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: { phoneNumber: fromNumber },
      to: [{ phoneNumber: toNumber }],
      text,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RingCentral send failed (${res.status}): ${json?.message || JSON.stringify(json)}`);
  return json;
}

function normalizePhone(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.startsWith('+')) return s;
  const digits = s.replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return s;
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
  } catch {
    return { sent: {} };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function fetchDocText() {
  const res = await fetch(DOC_EXPORT_URL, { headers: { Accept: 'text/plain' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to fetch followup doc export (${res.status}): ${t.slice(0, 200)}`);
  }
  return await res.text();
}

function pickDay1EveningSms(docText) {
  // Find "Day 1" then first "SMS – Evening" message (prefer one with booking link).
  const lines = docText.split(/\r?\n/);
  let inDay1 = false;
  let inEvening = false;
  const candidates = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (/^Day\s+1\b/i.test(line)) {
      inDay1 = true;
      inEvening = false;
      continue;
    }
    if (inDay1 && /^Day\s+2\b/i.test(line)) break;

    if (!inDay1) continue;

    if (/^SMS\s*[–-]\s*Evening/i.test(line) || /^SMS\s*\u2013\s*Evening/i.test(line)) {
      inEvening = true;
      continue;
    }
    if (inEvening) {
      if (!line) continue;
      if (line.startsWith('(') && line.endsWith(')')) continue;
      // stop if we hit another section
      if (/^SMS\s*[–-]\s*(Morning|Afternoon)/i.test(line) || /^Day\b/i.test(line) || /^Email\b/i.test(line) || /^Subject:/i.test(line)) {
        // don't turn off evening; we only want first few candidates
      }
      candidates.push(raw.trim());
      if (candidates.length >= 6) break;
    }
  }

  const withBook = candidates.find(s => /zbooking/i.test(s) || /\bbook\b/i.test(s));
  return withBook || candidates[0] || null;
}

function iso(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function main() {
  const state = await readState();
  const { tokens, repTokens } = await loadRepRefreshTokens();
  const docText = await fetchDocText();
  const eveningTemplate = pickDay1EveningSms(docText);
  if (!eveningTemplate) throw new Error('Could not find Day 1 evening SMS template in doc export');

  const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
  const zohoToken = await getZohoAccessToken();

  // Build Zoho user map for owners.
  const users = await zohoCrmGet({ accessToken: zohoToken, apiDomain, pathAndQuery: '/crm/v2/users?type=ActiveUsers' });
  const reps = (users.users || []).filter(u => Object.keys(REP_LINES).includes(u.full_name));
  const repIds = reps.map(r => `'${r.id}'`).join(',');

  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  // Leads with last activity older than cutoff OR null activity and created older than cutoff.
  const q = `select id, First_Name, Last_Name, Phone, Mobile, Email, Owner, Lead_Status, Created_Time, Last_Activity_Time from Leads where Owner in (${repIds}) and ((Last_Activity_Time <= '${iso(cutoff)}') or (Last_Activity_Time is null and Created_Time <= '${iso(cutoff)}')) limit ${Math.min(limit, 2000)}`;

  const res = await zohoCrmCoql({ accessToken: zohoToken, apiDomain, selectQuery: q });
  const leads = res?.data || [];

  let sentCount = 0;
  for (const lead of leads) {
    const leadId = String(lead.id);
    if (state.sent[leadId]) continue;

    const phone = normalizePhone(lead.Phone || lead.Mobile);
    if (!phone) continue;

    const ownerId = lead.Owner?.id;
    const owner = reps.find(r => r.id === ownerId);
    const ownerName = owner?.full_name;
    const fromNumber = ownerName ? REP_LINES[ownerName] : null;
    if (!fromNumber) continue;

    const firstName = String(lead.First_Name || '').trim();
    const msg = eveningTemplate.replace(/\[First Name\]/g, firstName || 'there');
    const text = `${msg}\n\n${BOOKING_LINE}`;

    if (dryRun) {
      process.stdout.write(`[dry-run] send to ${phone} from ${fromNumber} (${ownerName}) lead ${leadId}: ${text}\n\n`);
    } else {
      const refreshToken = repTokens[ownerName];
      if (!refreshToken) throw new Error(`Missing refresh token for rep: ${ownerName}`);
      const repKey = ownerName.toLowerCase().includes('adam') ? 'adam' : ownerName.toLowerCase().includes('amy') ? 'amy' : 'jared';
      await ringcentralSendSmsViaRefreshToken({ tokens, repKey, refreshToken, fromNumber, toNumber: phone, text });
      state.sent[leadId] = { at: new Date().toISOString(), to: phone, from: fromNumber, owner: ownerName };
      sentCount += 1;
    }
  }

  await writeState(state);
  process.stdout.write(`Done. dryRun=${dryRun} sent=${sentCount} candidates=${leads.length}\n`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
