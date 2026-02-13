#!/usr/bin/env node
/**
 * TYFYS Sales Lead Buckets Accountability Update (RingCentral Team Messaging)
 *
 * Posts a simple “lead aging buckets by rep” snapshot into the Sales Team chat.
 * Goal: accountability on speed-to-lead + stale follow-ups.
 *
 * Buckets are based on the most recent of:
 *  - Deals.Last_Activity_Time (Zoho datetime)
 *  - Deals.Last_Time_Contacted (Zoho text date, yyyy-mm-dd)
 *
 * Usage:
 *   node scripts/tyfys/sales-lead-buckets-ringcentral-update.mjs --chatId 156659499014
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

function parseYmd(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [_, y, mo, d] = m;
  // Interpret “date-only” as end of that local day to avoid over-penalizing.
  const dt = new Date(`${y}-${mo}-${d}T23:59:59`);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function maxDate(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

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
  const cols = ['rep', '<24h', '24–48h', '2–7d', '>7d', 'total'];
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

function isActiveStage(stage) {
  const s = String(stage || '').toLowerCase();
  if (!s) return true;
  // Conservative exclusions: remove terminal/paused buckets.
  if (s.includes('lost')) return false;
  if (s.includes('service complete')) return false;
  if (s.includes('service paused')) return false;
  return true;
}

(async function main() {
  const chatId = getArg('--chatId', null);
  if (!chatId) {
    console.error('Missing --chatId');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');

  const now = new Date();
  const accessToken = await getZohoAccessToken();

  // Pull a broad slice of “active” deals and bucket locally.
  // NOTE: COQL limits; we keep select small and page via offset.
  const pageSize = 200;
  const maxPages = 10; // up to 2000 rows

  let deals = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const q = `select id, Deal_Name, Stage, Owner, Last_Activity_Time, Last_Time_Contacted, Modified_Time from Deals where Modified_Time is not null order by Modified_Time desc limit ${pageSize} offset ${offset}`;
    const res = await zohoCrmCoql({ accessToken, apiDomain: ZOHO_API_DOMAIN, selectQuery: q });
    const rows = res?.data || [];
    deals.push(...rows);
    if (rows.length < pageSize) break;
  }

  // Filter to sales-owned + active-ish stages.
  deals = deals.filter(d => SALES_ROSTER.includes(d?.Owner?.name) && isActiveStage(d?.Stage));

  const byRep = new Map();
  for (const rep of SALES_ROSTER) {
    byRep.set(rep, { rep, '<24h': 0, '24–48h': 0, '2–7d': 0, '>7d': 0, total: 0 });
  }

  for (const d of deals) {
    const rep = d?.Owner?.name;
    if (!byRep.has(rep)) continue;

    const lastAct = d?.Last_Activity_Time ? new Date(d.Last_Activity_Time) : null;
    const lastTxt = parseYmd(d?.Last_Time_Contacted);
    const lastTouch = maxDate(lastAct, lastTxt);
    const h = hoursSince(lastTouch, now);
    const b = bucketLabel(h);

    const row = byRep.get(rep);
    row[b] += 1;
    row.total += 1;
  }

  const rows = SALES_ROSTER.map(r => byRep.get(r)).filter(Boolean);
  const table = fmtRows(rows);

  const header = `Lead buckets (as of ${now.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })} ET)`;
  const footer = `Goal: keep >7d at ~0 and 24–48h trending down. Update notes + next steps in Zoho.`;

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
