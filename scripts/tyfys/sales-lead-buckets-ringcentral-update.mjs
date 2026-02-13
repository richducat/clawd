#!/usr/bin/env node
/**
 * TYFYS Sales Lead Buckets Accountability Update (RingCentral Team Messaging)
 *
 * Posts a simple “lead aging buckets by rep” snapshot into the Sales Team chat.
 * Goal: accountability on speed-to-lead + stale follow-ups.
 *
 * Source of truth: Zoho CRM **Leads** (not Deals).
 * Bucket is based on Leads.Last_Activity_Time when present; otherwise fall back to Created_Time.
 *
 * Usage:
 *   node scripts/tyfys/sales-lead-buckets-ringcentral-update.mjs --chatId 156659499014 --tenant new
 */

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql } from '../lib/zoho.mjs';
import { ringcentralPostJson } from '../lib/ringcentral.mjs';

loadEnvLocal();

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const SALES_ROSTER = ['Adam', 'Amy', 'Jared', 'Ashley'];
const tenant = getArg('--tenant', 'new');
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

function hoursSince(dt, now) {
  if (!dt) return Infinity;
  return (now.getTime() - dt.getTime()) / 36e5;
}

function bucketLabel(h) {
  if (h < 24) return '<24h';
  if (h < 48) return '24–48h';
  if (h < 168) return '2–7d';
  return '>7d';
}

function fmtRows(rows) {
  const width = {
    rep: Math.max('Rep'.length, ...rows.map(r => r.rep.length)),
    '<24h': 5,
    '24–48h': 7,
    '2–7d': 5,
    '>7d': 4,
    total: 5,
  };

  const header = [
    'Rep'.padEnd(width.rep),
    '<24h'.padStart(width['<24h']),
    '24–48h'.padStart(width['24–48h']),
    '2–7d'.padStart(width['2–7d']),
    '>7d'.padStart(width['>7d']),
    'Total'.padStart(width.total),
  ].join('  ');

  const lines = rows.map(r => [
    r.rep.padEnd(width.rep),
    String(r['<24h']).padStart(width['<24h']),
    String(r['24–48h']).padStart(width['24–48h']),
    String(r['2–7d']).padStart(width['2–7d']),
    String(r['>7d']).padStart(width['>7d']),
    String(r.total).padStart(width.total),
  ].join('  '));

  return [header, ...lines].join('\n');
}

async function postToRingCentralChat({ chatId, text }) {
  return ringcentralPostJson(`/restapi/v1.0/glip/chats/${chatId}/posts`, { text }, { tenant });
}

function normRep(ownerName) {
  const n = String(ownerName || '');
  return SALES_ROSTER.find(r => n.toLowerCase().includes(r.toLowerCase())) || null;
}

function isActiveLeadStatus(status) {
  const s = String(status || '').toLowerCase();
  // Conservative exclusions only.
  if (s.includes('junk')) return false;
  if (s.includes('dead')) return false;
  if (s.includes('do not call')) return false;
  if (s.includes('opt')) return false;
  return true;
}

(async function main() {
  const chatId = getArg('--chatId', null);
  if (!chatId) {
    console.error('Missing --chatId');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const maxPages = Number(getArg('--maxPages', '10'));

  const now = new Date();
  const accessToken = await getZohoAccessToken();

  // COQL requires a WHERE clause.
  const pageSize = 200;
  let leads = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const q = `select id, Full_Name, Lead_Status, Owner, Last_Activity_Time, Created_Time, Modified_Time from Leads where Modified_Time is not null order by Modified_Time desc limit ${pageSize} offset ${offset}`;
    const res = await zohoCrmCoql({ accessToken, apiDomain: ZOHO_API_DOMAIN, selectQuery: q });
    const rows = res?.data || [];
    leads.push(...rows);
    if (rows.length < pageSize) break;
  }

  // Filter to sales-owned + active statuses.
  leads = leads.filter(l => normRep(l?.Owner?.name) && isActiveLeadStatus(l?.Lead_Status));

  const byRep = new Map();
  for (const rep of SALES_ROSTER) {
    byRep.set(rep, { rep, '<24h': 0, '24–48h': 0, '2–7d': 0, '>7d': 0, total: 0 });
  }

  for (const l of leads) {
    const rep = normRep(l?.Owner?.name);
    if (!rep) continue;

    const lastAct = l?.Last_Activity_Time ? new Date(l.Last_Activity_Time) : null;
    const created = l?.Created_Time ? new Date(l.Created_Time) : null;
    const lastTouch = lastAct || created;

    const h = hoursSince(lastTouch, now);
    const b = bucketLabel(h);

    const row = byRep.get(rep);
    row[b] += 1;
    row.total += 1;
  }

  const rows = SALES_ROSTER.map(r => byRep.get(r)).filter(Boolean);
  const table = fmtRows(rows);

  const header = `Lead buckets (Zoho Leads) — as of ${now.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })} ET`;
  const footer = `Goal: keep >7d near 0; clear 24–48h daily. Update next steps + notes in Zoho.`;

  const text = [header, '```', table, '```', footer].join('\n');

  if (dryRun) {
    process.stdout.write(`[dry-run] Would post to chatId=${chatId}:\n\n${text}\n`);
    return;
  }

  await postToRingCentralChat({ chatId, text });
  process.stdout.write('Posted lead buckets update to RingCentral chat.\n');
})().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
