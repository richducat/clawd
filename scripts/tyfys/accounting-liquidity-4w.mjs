#!/usr/bin/env node
/**
 * TYFYS liquidity addendum
 *
 * Purpose: show whether prior 2-week Stripe money in/out provides liquidity to cover current payroll.
 *
 * Windows:
 * - prior: (from-14d) → (from-1d)
 * - current: from → to
 * - combined: (from-14d) → to
 *
 * Output: memory/tyfys/accounting-liquidity_<prior>_to_<to>.md
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import Stripe from 'stripe';

import { loadEnvLocal } from '../lib/load-env-local.mjs';

loadEnvLocal();

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const fromArg = getArg('--from', null);
const toArg = getArg('--to', null);
if (!fromArg || !toArg) {
  console.error('Usage: node scripts/tyfys/accounting-liquidity-4w.mjs --from YYYY-MM-DD --to YYYY-MM-DD');
  process.exit(1);
}

const stripeKey = process.env.STRIPE_API_KEY;
if (!stripeKey) throw new Error('Missing STRIPE_API_KEY');
const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

function fmtCents(v) {
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

async function listAll(listFn, params) {
  const out = [];
  let starting_after;
  while (true) {
    const res = await listFn({ ...params, limit: 100, ...(starting_after ? { starting_after } : {}) });
    out.push(...res.data);
    if (!res.has_more) break;
    starting_after = res.data[res.data.length - 1].id;
  }
  return out;
}

async function stripeTotals({ from, to }) {
  const fromSec = Math.floor(from.getTime() / 1000);
  const toSec = Math.floor(to.getTime() / 1000);
  const tx = await listAll(stripe.balanceTransactions.list.bind(stripe.balanceTransactions), {
    created: { gte: fromSec, lte: toSec },
  });

  const totals = { grossIn: 0, grossOut: 0, fees: 0, net: 0, count: tx.length };
  for (const bt of tx) {
    if (bt.amount > 0) totals.grossIn += bt.amount;
    if (bt.amount < 0) totals.grossOut += -bt.amount;
    totals.fees += bt.fee;
    totals.net += bt.net;
  }
  return totals;
}

function parseETStart(ymd) {
  return new Date(`${ymd}T00:00:00-05:00`);
}
function parseETEnd(ymd) {
  return new Date(`${ymd}T23:59:59-05:00`);
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

(async function main() {
  const currentStart = parseETStart(fromArg);
  const currentEnd = parseETEnd(toArg);

  const priorStart = addDays(currentStart, -14);
  const priorEnd = addDays(currentStart, -1);

  const combinedStart = priorStart;
  const combinedEnd = currentEnd;

  const [prior, current, combined] = await Promise.all([
    stripeTotals({ from: priorStart, to: priorEnd }),
    stripeTotals({ from: currentStart, to: currentEnd }),
    stripeTotals({ from: combinedStart, to: combinedEnd }),
  ]);

  const md = [];
  md.push(`# TYFYS liquidity addendum (Stripe money in/out)`);
  md.push('');
  md.push(`Current payroll window: **${fromArg} → ${toArg}**`);
  md.push(`Prior 2-week window: **${ymd(priorStart)} → ${ymd(priorEnd)}**`);
  md.push(`Combined 4-week view: **${ymd(combinedStart)} → ${toArg}**`);
  md.push('');

  function block(label, t) {
    md.push(`## ${label}`);
    md.push(`- Gross in: **${fmtCents(t.grossIn)}**`);
    md.push(`- Gross out: **${fmtCents(t.grossOut)}**`);
    md.push(`- Fees: **${fmtCents(t.fees)}**`);
    md.push(`- Net: **${fmtCents(t.net)}**`);
    md.push(`- Count tx: ${t.count}`);
    md.push('');
  }

  block('Prior 2 weeks (Stripe)', prior);
  block('Current 2 weeks (Stripe)', current);
  block('Combined 4 weeks (Stripe)', combined);

  md.push(`Note: This is Stripe balance-transaction based. Because payouts move within ~2 business days, the prior window can contribute liquidity for the current payroll even if the current window is net-negative.`);

  await fs.mkdir(path.resolve('memory/tyfys'), { recursive: true });
  const outPath = path.resolve('memory/tyfys', `accounting-liquidity_${ymd(priorStart)}_to_${toArg}.md`);
  await fs.writeFile(outPath, md.join('\n') + '\n', 'utf8');
  process.stdout.write(`Wrote ${outPath}\n`);
})().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
