#!/usr/bin/env node
/**
 * Pull a basic finance overview from Stripe balance transactions and write JSON.
 * Uses STRIPE_API_KEY from .env.local.
 *
 * Output: memory/stripe-finance-overview.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import Stripe from 'stripe';
import { loadEnvLocal } from '../lib/load-env-local.mjs';

loadEnvLocal();

const apiKey = process.env.STRIPE_API_KEY;
if (!apiKey) throw new Error('Missing STRIPE_API_KEY in env');

const stripe = new Stripe(apiKey, { apiVersion: '2024-06-20' });

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const days = Number(getArg('--days', '90'));
const nowSec = Math.floor(Date.now() / 1000);
const fromSec = nowSec - days * 24 * 3600;
const currency = (getArg('--currency', 'usd') || 'usd').toLowerCase();

function fmt(amount, cur = currency) {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}$${(abs / 100).toFixed(2)} ${cur.toUpperCase()}`;
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

const balanceTx = await listAll(stripe.balanceTransactions.list.bind(stripe.balanceTransactions), {
  created: { gte: fromSec, lte: nowSec },
});

const payouts = await listAll(stripe.payouts.list.bind(stripe.payouts), {
  created: { gte: fromSec, lte: nowSec },
});

// Build customer rollup from charges attached to balance transactions when possible.
const charges = await listAll(stripe.charges.list.bind(stripe.charges), {
  created: { gte: fromSec, lte: nowSec },
  limit: 100,
});

const chargeById = new Map(charges.map((c) => [c.id, c]));

const totals = {
  count: balanceTx.length,
  amountSum: 0,
  feeSum: 0,
  netSum: 0,
  grossIn: 0,
  grossOut: 0,
};

const byType = {};

for (const bt of balanceTx) {
  totals.amountSum += bt.amount;
  totals.feeSum += bt.fee;
  totals.netSum += bt.net;
  if (bt.amount > 0) totals.grossIn += bt.amount;
  if (bt.amount < 0) totals.grossOut += -bt.amount;

  byType[bt.type] ||= { count: 0, amount: 0, fee: 0, net: 0 };
  byType[bt.type].count += 1;
  byType[bt.type].amount += bt.amount;
  byType[bt.type].fee += bt.fee;
  byType[bt.type].net += bt.net;
}

const payoutStatusCounts = {};
let payoutAmount = 0;
for (const p of payouts) {
  payoutAmount += p.amount;
  payoutStatusCounts[p.status] = (payoutStatusCounts[p.status] || 0) + 1;
}

const customerGross = new Map();
for (const bt of balanceTx) {
  if (!['charge', 'payment', 'payment_refund'].includes(bt.type)) continue;
  // balance transaction source is usually charge id for charges.
  const source = bt.source;
  const ch = source ? chargeById.get(source) : null;
  const custId = ch?.customer || 'no_customer';
  const email = ch?.billing_details?.email || null;
  const name = ch?.billing_details?.name || null;
  const desc = ch?.description || null;
  const key = custId;
  const prev = customerGross.get(key) || { custId: key, gross: 0, customer: ch?.customer || null, email, name, description: desc };
  // For gross, use positive inflows only
  if (bt.amount > 0) prev.gross += bt.amount;
  if (!prev.email && email) prev.email = email;
  if (!prev.name && name) prev.name = name;
  if (!prev.description && desc) prev.description = desc;
  customerGross.set(key, prev);
}

const topCustomers = Array.from(customerGross.values())
  .sort((a, b) => b.gross - a.gross)
  .slice(0, 25)
  .map((c) => ({ ...c, grossFormatted: fmt(c.gross) }));

const out = {
  range: {
    from: new Date(fromSec * 1000).toISOString(),
    to: new Date(nowSec * 1000).toISOString(),
    fromSec,
    toSec: nowSec,
  },
  totals,
  totalsFormatted: {
    grossIn: fmt(totals.grossIn),
    grossOut: fmt(totals.grossOut),
    amountSum: fmt(totals.amountSum),
    feeSum: fmt(totals.feeSum),
    netSum: fmt(totals.netSum),
  },
  byType,
  byTypeFormatted: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { ...v, amount: fmt(v.amount), fee: fmt(v.fee), net: fmt(v.net) }])),
  payouts: {
    count: payouts.length,
    amount: payoutAmount,
    statusCounts: payoutStatusCounts,
  },
  payoutsFormatted: {
    amount: fmt(payoutAmount),
    statuses: payoutStatusCounts,
  },
  topCustomers,
  counts: {
    balanceTransactions: balanceTx.length,
    charges: charges.length,
    payouts: payouts.length,
  },
};

await fs.mkdir(path.resolve('memory'), { recursive: true });
const outPath = path.resolve('memory/stripe-finance-overview.json');
await fs.writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

// print top 5 for quick human glance
process.stdout.write(`${currency.toUpperCase()} :: `);
for (const c of topCustomers.slice(0, 5)) {
  process.stdout.write(`${c.email || ''} ${c.name || ''} ${c.custId} - ${c.grossFormatted} :: `);
}
process.stdout.write(`\nWrote ${outPath}\n`);
