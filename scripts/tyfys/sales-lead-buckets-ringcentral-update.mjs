#!/usr/bin/env node
/**
 * TYFYS Sales Lead Buckets Accountability Update (RingCentral Team Messaging)
 *
 * Posts a simple “lead aging buckets by rep” snapshot into the Sales Team chat.
 * Goal: accountability on speed-to-lead + stale follow-ups.
 *
 * Source of truth: Zoho CRM Leads via REST list API (COQL is not available for Leads in this org).
 * Bucket is based on Leads.Last_Activity_Time when present; otherwise fall back to Created_Time.
 *
 * Usage:
 *   node scripts/tyfys/sales-lead-buckets-ringcentral-update.mjs --chatId 156659499014 --tenant new
 */

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmGet } from '../lib/zoho.mjs';
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
const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

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

function fmtBullets(rows) {
  // RingCentral formatting is inconsistent with fixed-width tables.
  // Use simple bullets + labeled counts for readability.
  return rows
    .map(r => `- ${r.rep}: <24h ${r['<24h']} | 24–48h ${r['24–48h']} | 2–7d ${r['2–7d']} | >7d ${r['>7d']} | total ${r.total}`)
    .join('\n');
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

async function listLeadsPage({ accessToken, page, perPage, days }) {
  const fields = [
    'id',
    'Owner',
    'Lead_Status',
    'Created_Time',
    'Modified_Time',
    'Last_Activity_Time',
  ].join(',');

  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const sinceYmd = since.toISOString().slice(0, 10);
  const criteria = `(Modified_Time:after:${sinceYmd})`;

  const pathAndQuery = `/crm/v2/Leads?fields=${encodeURIComponent(fields)}&page=${page}&per_page=${perPage}&criteria=${encodeURIComponent(criteria)}`;
  const res = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery });
  return { leads: res?.data || [], info: res?.info || {} };
}

(async function main() {
  const chatId = getArg('--chatId', null);
  if (!chatId) {
    console.error('Missing --chatId');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const days = Number(getArg('--days', '365'));
  const perPage = Number(getArg('--perPage', '200'));
  const maxPages = Number(getArg('--pages', '10'));

  const now = new Date();
  const accessToken = await getZohoAccessToken();

  let leads = [];
  for (let page = 1; page <= maxPages; page++) {
    const { leads: rows, info } = await listLeadsPage({ accessToken, page, perPage, days });
    leads.push(...rows);
    if (!info?.more_records || rows.length === 0) break;
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
  const bullets = fmtBullets(rows);

  const header = `Lead buckets (Zoho Leads) — as of ${now.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })} ET`;
  const footer = `Focus today: clear >7d first, then 24–48h. Keep Zoho notes + next steps current.`;

  const text = [header, bullets, footer].join('\n\n');

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
