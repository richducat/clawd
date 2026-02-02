#!/usr/bin/env node
/**
 * Stripe Monthly Clients List (TYFYS)
 *
 * Outputs a CSV + summary for all active-ish monthly subscriptions.
 *
 * Env:
 *   STRIPE_API_KEY (rk_... or sk_...)
 *
 * Usage:
 *   node scripts/tyfys/stripe-monthly-clients.mjs --outDir zoho_exports
 *   node scripts/tyfys/stripe-monthly-clients.mjs --outDir zoho_exports --allStatuses
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

const args = process.argv.slice(2);
const outDir = (() => {
  const i = args.indexOf('--outDir');
  return i !== -1 ? args[i + 1] : 'zoho_exports';
})();
const allStatuses = args.includes('--allStatuses');

const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
if (!STRIPE_API_KEY) throw new Error('Missing STRIPE_API_KEY in env');

const STRIPE_API = 'https://api.stripe.com';

function fmtUsd(cents, currency = 'usd') {
  if (cents == null) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format((Number(cents) || 0) / 100);
  } catch {
    return `${(Number(cents) || 0) / 100} ${currency}`;
  }
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[\n\r",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function stripeGet(pathAndQuery) {
  const url = `${STRIPE_API}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${STRIPE_API_KEY}`,
      'Stripe-Version': '2024-06-20',
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe GET ${pathAndQuery} failed (${res.status}): ${json?.error?.message || JSON.stringify(json)}`);
  return json;
}

async function listSubscriptions() {
  const statuses = allStatuses
    ? ['all']
    : ['active', 'trialing', 'past_due', 'unpaid'];

  const subs = [];
  for (const status of statuses) {
    let startingAfter = null;
    for (;;) {
      const qs = new URLSearchParams({
        limit: '100',
        status,
      });
      qs.append('expand[]', 'data.customer');
      qs.append('expand[]', 'data.latest_invoice.payment_intent');
      // (product expand omitted due to Stripe depth limit)
      if (startingAfter) qs.set('starting_after', startingAfter);
      const j = await stripeGet(`/v1/subscriptions?${qs.toString()}`);
      for (const s of j.data || []) subs.push(s);
      if (!j.has_more) break;
      startingAfter = j.data?.[j.data.length - 1]?.id;
      if (!startingAfter) break;
    }
  }
  // de-dupe by id (in case status=all)
  const byId = new Map();
  for (const s of subs) byId.set(s.id, s);
  return [...byId.values()];
}

function isMonthly(sub) {
  const items = sub?.items?.data || [];
  // treat as monthly if ANY item is monthly (common)
  return items.some(it => it?.price?.recurring?.interval === 'month');
}

function computeMrrCents(sub) {
  // Sum monthly items; if annual etc, ignore for now.
  let cents = 0;
  for (const it of sub?.items?.data || []) {
    const interval = it?.price?.recurring?.interval;
    const unit = it?.price?.unit_amount ?? 0;
    const qty = it?.quantity ?? 1;
    if (interval === 'month') cents += Number(unit) * Number(qty);
  }
  return cents;
}

function customerInfo(cust) {
  if (!cust || typeof cust !== 'object') return {};
  return {
    customer_id: cust.id,
    customer_name: cust.name || cust.shipping?.name || '',
    customer_email: cust.email || '',
    customer_phone: cust.phone || '',
  };
}

function lastInvoiceInfo(sub) {
  const inv = sub?.latest_invoice;
  if (!inv || typeof inv !== 'object') return {};
  const pi = inv.payment_intent;
  const paidAt = inv.status_transitions?.paid_at
    ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
    : '';
  return {
    latest_invoice_id: inv.id || '',
    latest_invoice_status: inv.status || '',
    latest_invoice_total: inv.total != null ? fmtUsd(inv.total, inv.currency) : '',
    latest_invoice_paid_at: paidAt,
    latest_payment_intent_status: pi?.status || '',
    latest_payment_intent_last_error: pi?.last_payment_error?.message || '',
  };
}

function productSummary(sub) {
  const items = sub?.items?.data || [];
  const names = [];
  for (const it of items) {
    const interval = it?.price?.recurring?.interval;
    const price = it?.price;
    const priceLabel = price?.nickname || price?.id || 'Unknown';
    const qty = it?.quantity ?? 1;
    names.push(`${priceLabel} x${qty} (${interval || 'n/a'})`);
  }
  return names.join(' | ');
}

async function main() {
  const subs = await listSubscriptions();
  const monthlySubs = subs.filter(isMonthly);

  // Sort by status severity then MRR desc
  const statusRank = (s) => ({ unpaid: 0, past_due: 1, trialing: 2, active: 3, canceled: 4 }[s] ?? 9);
  monthlySubs.sort((a, b) => {
    const ra = statusRank(a.status);
    const rb = statusRank(b.status);
    if (ra !== rb) return ra - rb;
    return computeMrrCents(b) - computeMrrCents(a);
  });

  const rows = [];
  for (const sub of monthlySubs) {
    const cust = sub.customer;
    const ci = customerInfo(cust);
    const mrrCents = computeMrrCents(sub);
    const periodStart = sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : '';
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : '';

    rows.push({
      subscription_id: sub.id,
      subscription_status: sub.status,
      cancel_at_period_end: sub.cancel_at_period_end ? 'true' : 'false',
      current_period_start: periodStart,
      current_period_end: periodEnd,
      mrr: fmtUsd(mrrCents, sub.currency),
      products: productSummary(sub),
      ...ci,
      ...lastInvoiceInfo(sub),
      collection_method: sub.collection_method || '',
    });
  }

  const headers = Object.keys(rows[0] || {
    subscription_id: '',
    subscription_status: '',
    cancel_at_period_end: '',
    current_period_start: '',
    current_period_end: '',
    mrr: '',
    products: '',
    customer_id: '',
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    latest_invoice_id: '',
    latest_invoice_status: '',
    latest_invoice_total: '',
    latest_invoice_paid_at: '',
    latest_payment_intent_status: '',
    latest_payment_intent_last_error: '',
    collection_method: '',
  });

  const csv = [headers.join(',')]
    .concat(rows.map(r => headers.map(h => csvEscape(r[h])).join(',')))
    .join('\n') + '\n';

  const day = new Date().toISOString().slice(0, 10);
  const outPath = path.resolve(outDir, `stripe-monthly-clients-${day}.csv`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, csv, 'utf8');

  const counts = monthlySubs.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});
  const totalMrrCents = monthlySubs.reduce((sum, s) => sum + computeMrrCents(s), 0);

  const topRisk = rows.filter(r => ['past_due', 'unpaid'].includes(r.subscription_status)).slice(0, 15);

  const summary = [
    `Stripe monthly subs: ${monthlySubs.length}`,
    `Status counts: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}`,
    `Total monthly MRR (monthly items only): ${fmtUsd(totalMrrCents, 'usd')}`,
    `CSV: ${outPath}`,
    '',
    'Top risk (past_due/unpaid):',
    ...topRisk.map(r => `- ${r.customer_name || r.customer_email || r.customer_id} | ${r.subscription_status} | MRR ${r.mrr} | period_end ${r.current_period_end.slice(0,10)} | last_err ${r.latest_payment_intent_last_error || r.latest_invoice_status || ''}`),
    '',
  ].join('\n');

  const summaryPath = path.resolve(outDir, `stripe-monthly-clients-${day}.summary.txt`);
  await fs.writeFile(summaryPath, summary, 'utf8');

  process.stdout.write(summary);
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
