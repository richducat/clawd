#!/usr/bin/env node
/**
 * TYFYS Sales Payroll Calculator (biweekly; Wed→Wed)
 *
 * Computes:
 * - New deals created in the period by owner
 * - Per-deal payout ($250 default; exceptions supported)
 * - Call quota bonus: $50/week if rep hit 25 outbound calls/day for each business day in that week
 *
 * Notes / assumptions:
 * - Periods are Wed 00:00 ET → next Wed 00:00 ET (exclusive end)
 * - Deal payout uses Zoho Deals Created_Time and Owner
 * - Call quota uses RingCentral outbound call logs by extension
 * - THIS SCRIPT DOES NOT SEND EMAIL. It outputs a markdown report + JSON.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmGet } from '../lib/zoho.mjs';
import { ringcentralGetJson } from '../lib/ringcentral.mjs';

loadEnvLocal();

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const tenant = getArg('--tenant', 'new');
const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

// Reps we care about for payroll.
const SALES_ROSTER = ['Adam', 'Amy', 'Jared'];

// Deal payouts
const DEFAULT_DEAL_PAYOUT = 250;
// Exception: Jeremy Johns is Adam referral: $200 lead + $75 referral.
const DEAL_EXCEPTIONS = [
  {
    matchNameIncludes: 'jeremy johns',
    payoutByRep: { Adam: 275 },
    note: 'Referral exception: $200 lead + $75 referral',
  },
];

// Bonus
const CALL_QUOTA_PER_DAY = 25;
const WEEKLY_CALL_BONUS = 50;
const CONNECTED_SEC = 30; // for reference; not used for quota

function isoNoMs(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function etStartOfDay(d) {
  // best-effort local; host is ET
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtDateET(d) {
  return etStartOfDay(d).toISOString().slice(0, 10);
}

function parseIso(v) {
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function normRep(nameLike) {
  const n = String(nameLike || '').toLowerCase();
  return SALES_ROSTER.find(r => n.includes(r.toLowerCase())) || null;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function computeWindow({ end, fromArg, toArg }) {
  // If user provides explicit from/to, honor it.
  if (fromArg && toArg) {
    const from = new Date(`${fromArg}T00:00:00-05:00`);
    const to = new Date(`${toArg}T23:59:59-05:00`);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      throw new Error('Invalid --from/--to. Use YYYY-MM-DD.');
    }
    // COQL end is exclusive; add 1s.
    return { periodStart: from, periodEnd: new Date(to.getTime() + 1000) };
  }

  // Default: Wed→Wed biweekly. end is a Date at which period ends (exclusive). Default: most recent Wednesday 00:00.
  const endDay = etStartOfDay(end);
  // Walk back to Wednesday.
  const d = new Date(endDay);
  while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  const periodEnd = d;
  const periodStart = new Date(periodEnd.getTime() - 14 * 24 * 3600 * 1000);
  return { periodStart, periodEnd };
}

async function fetchDealsCreated({ accessToken, from, to }) {
  // COQL needs WHERE + no ms. (Owner can be omitted/blank here; we enrich via GET per deal.)
  const q = `select id, Deal_Name, Created_Time from Deals where Created_Time >= '${isoNoMs(from)}' and Created_Time < '${isoNoMs(to)}' order by Created_Time asc limit 200`;
  const res = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: q });
  return res?.data || [];
}

async function enrichDealOwner({ accessToken, deal }) {
  const dealId = String(deal?.id || '');
  if (!dealId) return deal;
  const fields = ['id', 'Deal_Name', 'Owner', 'Created_By', 'Created_Time'].join(',');
  const pathAndQuery = `/crm/v2/Deals/${encodeURIComponent(dealId)}?fields=${encodeURIComponent(fields)}`;
  const res = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery }).catch(() => null);
  const full = res?.data?.[0];
  if (!full) return deal;
  return { ...deal, Owner: full.Owner, Created_By: full.Created_By };
}

function payoutForDeal({ dealName, rep }) {
  const name = String(dealName || '').toLowerCase();
  for (const ex of DEAL_EXCEPTIONS) {
    if (name.includes(ex.matchNameIncludes)) {
      const p = ex.payoutByRep?.[rep];
      if (typeof p === 'number') return { payout: p, note: ex.note };
    }
  }
  return { payout: DEFAULT_DEAL_PAYOUT, note: null };
}

async function getRcExtensionsForRoster() {
  const extRes = await ringcentralGetJson('/restapi/v1.0/account/~/extension?perPage=200', { tenant });
  const exts = extRes?.records || [];

  const roster = new Map();
  for (const rep of SALES_ROSTER) {
    const match = exts.find(e => {
      const n = `${e?.contact?.firstName || ''} ${e?.contact?.lastName || ''}`.trim();
      const uname = String(e?.name || '');
      return n.toLowerCase().includes(rep.toLowerCase()) || uname.toLowerCase().includes(rep.toLowerCase());
    });
    if (match?.id) roster.set(rep, match.id);
  }
  return roster;
}

function isBusinessDay(d) {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function listDays(from, to) {
  const out = [];
  const d = etStartOfDay(from);
  while (d < to) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

async function fetchOutboundCallsByDay({ extId, from, to }) {
  // Pull call log for the window and bucket by local day.
  const callLog = await ringcentralGetJson(
    `/restapi/v1.0/account/~/extension/${extId}/call-log?dateFrom=${encodeURIComponent(isoNoMs(from))}&dateTo=${encodeURIComponent(isoNoMs(to))}&perPage=1000`,
    { tenant },
  );

  const out = new Map();
  for (const r of callLog?.records || []) {
    if (r.direction !== 'Outbound') continue;
    const start = parseIso(r.startTime);
    if (!start) continue;
    const k = fmtDateET(start);
    out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
}

function computeWeeklyCallBonus({ outboundByDay, from, to }) {
  // Weeks are Wed→Wed; bonus assessed for each 7-day block within the 14-day period.
  // Rule: $50 if rep hit 25 outbound calls on EACH business day in that week.
  const days = listDays(from, to);
  const weeks = [
    { start: from, end: new Date(from.getTime() + 7 * 24 * 3600 * 1000) },
    { start: new Date(from.getTime() + 7 * 24 * 3600 * 1000), end: to },
  ];

  const weekResults = [];
  for (const w of weeks) {
    const wDays = days.filter(d => d >= w.start && d < w.end && isBusinessDay(d));
    let ok = true;
    const perDay = [];
    for (const d of wDays) {
      const k = fmtDateET(d);
      const c = outboundByDay.get(k) || 0;
      perDay.push({ day: k, calls: c, hit: c >= CALL_QUOTA_PER_DAY });
      if (c < CALL_QUOTA_PER_DAY) ok = false;
    }
    weekResults.push({
      start: fmtDateET(w.start),
      end: fmtDateET(new Date(w.end.getTime() - 1)),
      businessDays: wDays.length,
      hit: ok && wDays.length > 0,
      bonus: ok && wDays.length > 0 ? WEEKLY_CALL_BONUS : 0,
      perDay,
    });
  }
  return weekResults;
}

(async function main() {
  const endArg = getArg('--end', null);
  const fromArg = getArg('--from', null);
  const toArg = getArg('--to', null);

  const end = endArg ? new Date(endArg) : new Date();
  const { periodStart, periodEnd } = computeWindow({ end, fromArg, toArg });

  const outDir = path.resolve('memory/tyfys');
  await ensureDir(outDir);
  const outBase = fromArg && toArg
    ? `sales-payroll_${fromArg}_to_${toArg}`
    : `sales-payroll-${fmtDateET(periodEnd)}`;
  const outJson = path.join(outDir, `${outBase}.json`);
  const outMd = path.join(outDir, `${outBase}.md`);

  const accessToken = await getZohoAccessToken();

  // Deals created
  let deals = await fetchDealsCreated({ accessToken, from: periodStart, to: periodEnd });
  // Enrich owner/created_by via per-record GET (Owner sometimes missing in COQL responses)
  deals = await Promise.all(deals.map(d => enrichDealOwner({ accessToken, deal: d })));

  const dealsByRep = new Map();
  for (const rep of SALES_ROSTER) dealsByRep.set(rep, []);

  const unassigned = [];
  for (const d of deals) {
    const dealName = d?.Deal_Name || '';

    // Hard-coded business rule: Jeremy Johns is Adam referral.
    // (Owner/createdBy may not reflect who sourced the deal.)
    const repOverride = String(dealName).toLowerCase().includes('jeremy johns') ? 'Adam' : null;

    const rep = repOverride || normRep(d?.Owner?.name) || normRep(d?.Created_By?.name);
    if (!rep) {
      unassigned.push({ id: d.id, dealName, owner: d?.Owner?.name, createdBy: d?.Created_By?.name });
      continue;
    }

    const { payout, note } = payoutForDeal({ dealName, rep });
    dealsByRep.get(rep).push({
      id: d.id,
      dealName,
      createdTime: d.Created_Time,
      payout,
      note,
    });
  }

  // Call bonus
  const rosterExt = await getRcExtensionsForRoster();
  const callBonusByRep = new Map();

  for (const rep of SALES_ROSTER) {
    const extId = rosterExt.get(rep);
    if (!extId) {
      callBonusByRep.set(rep, { missingExtension: true, weeks: [], totalBonus: 0 });
      continue;
    }
    const outboundByDay = await fetchOutboundCallsByDay({ extId, from: periodStart, to: periodEnd });
    const weeks = computeWeeklyCallBonus({ outboundByDay, from: periodStart, to: periodEnd });
    const totalBonus = weeks.reduce((s, w) => s + (w.bonus || 0), 0);
    callBonusByRep.set(rep, { missingExtension: false, weeks, totalBonus });
  }

  // Totals
  const summary = [];
  let grandTotal = 0;
  for (const rep of SALES_ROSTER) {
    const repDeals = dealsByRep.get(rep) || [];
    const dealTotal = repDeals.reduce((s, x) => s + (x.payout || 0), 0);
    const bonus = callBonusByRep.get(rep)?.totalBonus || 0;
    const total = dealTotal + bonus;
    grandTotal += total;
    summary.push({ rep, deals: repDeals.length, dealTotal, bonus, total });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    tenant,
    window: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      label: `${fmtDateET(periodStart)} → ${fmtDateET(new Date(periodEnd.getTime() - 1))}`,
    },
    dealPayouts: {
      default: DEFAULT_DEAL_PAYOUT,
      exceptions: DEAL_EXCEPTIONS,
    },
    callBonus: {
      quotaPerDay: CALL_QUOTA_PER_DAY,
      weeklyBonus: WEEKLY_CALL_BONUS,
      connectedSecReference: CONNECTED_SEC,
    },
    dealsByRep: Object.fromEntries([...dealsByRep.entries()]),
    dealsUnassigned: unassigned,
    callBonusByRep: Object.fromEntries([...callBonusByRep.entries()]),
    summary,
    grandTotal,
  };

  await fs.writeFile(outJson, JSON.stringify(payload, null, 2));

  const lines = [];
  lines.push(`# TYFYS sales payroll calc`);
  lines.push('');
  lines.push(`Window (ET): **${payload.window.label}** (Wed→Wed, 14 days)`);
  lines.push('');
  lines.push(`Deal payout: **$${DEFAULT_DEAL_PAYOUT}/new deal** (exceptions: Jeremy Johns referral handling)`);
  lines.push(`Call bonus: **$${WEEKLY_CALL_BONUS}/week** if rep hit **${CALL_QUOTA_PER_DAY} outbound calls/day** for each business day (Wed→Wed weekly blocks)`);
  lines.push('');

  lines.push('## Summary (amounts due)');
  for (const s of summary) {
    lines.push(`- **${s.rep}** — deals: ${s.deals} ($${s.dealTotal}) + call bonus $${s.bonus} => **$${s.total}**`);
  }
  lines.push(`- **TOTAL**: **$${grandTotal}**`);
  lines.push('');

  lines.push('## Deal details');
  for (const rep of SALES_ROSTER) {
    const repDeals = dealsByRep.get(rep) || [];
    lines.push(`### ${rep} (${repDeals.length})`);
    if (!repDeals.length) {
      lines.push('- (none)');
      lines.push('');
      continue;
    }
    for (const d of repDeals) {
      lines.push(`- $${d.payout} — ${d.dealName}${d.note ? ` (${d.note})` : ''}`);
    }
    lines.push('');
  }

  if (unassigned.length) {
    lines.push('## Unassigned deals (needs mapping to rep)');
    for (const d of unassigned) {
      lines.push(`- ${d.dealName} — owner=${d.owner || '—'} createdBy=${d.createdBy || '—'} (id ${d.id})`);
    }
    lines.push('');
  }

  lines.push('## Call bonus breakdown');
  for (const rep of SALES_ROSTER) {
    const cb = callBonusByRep.get(rep);
    lines.push(`### ${rep}`);
    if (cb?.missingExtension) {
      lines.push('- Missing RingCentral extension mapping (cannot compute call quota bonus).');
      lines.push('');
      continue;
    }
    for (const w of cb.weeks || []) {
      lines.push(`- Week ${w.start} → ${w.end}: ${w.hit ? 'HIT' : 'MISS'} => $${w.bonus}`);
    }
    lines.push(`- Total call bonus: $${cb.totalBonus || 0}`);
    lines.push('');
  }

  await fs.writeFile(outMd, lines.join('\n'));

  process.stdout.write(
    `DONE window=${payload.window.label} deals_total=${deals.length} grand_total=$${grandTotal} out_md=${outMd} out_json=${outJson}\n`
  );
})().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
