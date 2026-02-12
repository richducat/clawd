#!/usr/bin/env node
/**
 * Stripe → Zoho Deals sync (subscriptions)
 *
 * Purpose:
 * - Keep Zoho Deals updated with Stripe subscription status + lifetime paid totals.
 * - Match Stripe customer to Zoho Deal by customer.email == Deals.Email_Address.
 * - Once matched, write Stripe_Customer_ID + Stripe_Subscription_ID back to the Deal for stability.
 *
 * Guardrails:
 * - Ops-only financial fields; do not message clients.
 * - Safe mode supported via --dry-run.
 *
 * Usage:
 *   node scripts/tyfys/stripe-sync-to-zoho-deals.mjs --dry-run
 *   node scripts/tyfys/stripe-sync-to-zoho-deals.mjs --send
 *
 * Options:
 *   --sinceHours 72   (default: 72)  // pull Stripe events over this window
 *   --limit 200       (default: 200) // max Stripe events to process
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import Stripe from 'stripe';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmPut } from '../lib/zoho.mjs';

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

const sinceHours = Number(getArg('--sinceHours', '72'));
const limit = Number(getArg('--limit', '200'));

const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
if (!STRIPE_API_KEY) {
  console.error('Missing STRIPE_API_KEY in env');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_API_KEY);

const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const STATE_PATH = path.resolve('memory/stripe-zoho-sync.json');

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
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function findDealByEmail({ accessToken, email }) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;

  const q = `select id, Deal_Name, Email_Address from Deals where Email_Address = '${escZoho(e)}' order by Modified_Time desc limit 5`;
  const res = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: q });
  const rows = res?.data || [];
  return rows[0] || null;
}

async function computeCustomerTotals({ customerId }) {
  // Lifetime totals from paid invoices (approx: sum total_paid). Limited to last 100 invoices per customer.
  // If you need full-lifetime for long histories, we can page further.
  const inv = await stripe.invoices.list({ customer: customerId, limit: 100 });
  let lifetimePaid = 0;
  let refundedTotal = 0;
  let lastPaidAt = null;
  let lastInvoiceAmount = null;

  for (const i of inv.data || []) {
    if (i.status === 'paid') {
      lifetimePaid += (i.total_paid || 0);
      const paidAt = i.status_transitions?.paid_at ? new Date(i.status_transitions.paid_at * 1000) : null;
      if (paidAt && (!lastPaidAt || paidAt > lastPaidAt)) {
        lastPaidAt = paidAt;
        lastInvoiceAmount = i.total_paid || i.amount_paid || null;
      }
    }
    // Refunds: easiest via charge.refunded events; here we use amount_refunded if present.
    refundedTotal += (i.amount_refunded || 0);
  }

  return {
    lifetimePaidCents: lifetimePaid,
    refundedTotalCents: refundedTotal,
    lastPaidAt: lastPaidAt ? lastPaidAt.toISOString() : null,
    lastInvoiceAmountCents: lastInvoiceAmount,
  };
}

function centsToDollars(cents) {
  if (cents == null) return null;
  return Math.round(Number(cents)) / 100;
}

async function upsertDealStripeFields({ accessToken, dealId, fields }) {
  if (dryRun) return { dryRun: true };
  return zohoCrmPut({
    accessToken,
    apiDomain,
    path: `/crm/v2/Deals/${dealId}`,
    json: { data: [fields] },
  });
}

async function main() {
  const accessToken = await getZohoAccessToken();
  const state = await readJson(STATE_PATH, { lastRunAt: null });

  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const events = await stripe.events.list({
    created: { gte: Math.floor(since.getTime() / 1000) },
    limit: Math.min(Math.max(limit, 1), 200),
    types: [
      'invoice.paid',
      'invoice.payment_failed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ],
  });

  const uniqCustomers = new Map();
  for (const ev of events.data || []) {
    const obj = ev.data?.object;
    const customerId = obj?.customer;
    if (customerId) uniqCustomers.set(String(customerId), true);
  }

  let matched = 0;
  let updated = 0;
  let skippedNoEmail = 0;
  let skippedNoDeal = 0;

  for (const customerId of uniqCustomers.keys()) {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer?.deleted) continue;

    const email = String(customer.email || '').trim().toLowerCase();
    if (!email) {
      skippedNoEmail += 1;
      continue;
    }

    const deal = await findDealByEmail({ accessToken, email });
    if (!deal?.id) {
      skippedNoDeal += 1;
      continue;
    }

    matched += 1;

    // Pull latest subscription for this customer (assumes 0-1 primary subscription; if multiple, pick most recently created).
    const subs = await stripe.subscriptions.list({ customer: customerId, limit: 10, status: 'all' });
    const sorted = [...(subs.data || [])].sort((a, b) => (b.created || 0) - (a.created || 0));
    const sub = sorted[0] || null;

    const status = sub?.status || 'none';
    const mrrCents = sub?.items?.data?.[0]?.price?.unit_amount ? (sub.items.data[0].price.unit_amount * (sub.items.data[0].quantity || 1)) : null;

    const totals = await computeCustomerTotals({ customerId });

    const fields = {
      Stripe_Customer_ID: customerId,
      ...(sub?.id ? { Stripe_Subscription_ID: sub.id } : {}),
      Stripe_Status: status,
      ...(mrrCents != null ? { Stripe_MRR: centsToDollars(mrrCents) } : {}),
      Stripe_Lifetime_Paid: centsToDollars(totals.lifetimePaidCents),
      ...(totals.lastPaidAt ? { Stripe_Last_Payment_Date: totals.lastPaidAt } : {}),
      ...(totals.lastInvoiceAmountCents != null ? { Stripe_Last_Invoice_Amount: centsToDollars(totals.lastInvoiceAmountCents) } : {}),
      Stripe_Refunded_Total: centsToDollars(totals.refundedTotalCents),
    };

    if (dryRun) {
      process.stdout.write(`[dry-run] would update deal ${deal.Deal_Name || deal.id} (${deal.id}) for ${email}: ${JSON.stringify(fields)}\n`);
    } else {
      await upsertDealStripeFields({ accessToken, dealId: deal.id, fields });
      updated += 1;
    }
  }

  state.lastRunAt = new Date().toISOString();
  await writeJson(STATE_PATH, state);

  process.stdout.write(
    `Done. dryRun=${dryRun} sinceHours=${sinceHours} stripeEvents=${events.data?.length || 0} customers=${uniqCustomers.size} matchedDeals=${matched} updated=${updated} skippedNoEmail=${skippedNoEmail} skippedNoDeal=${skippedNoDeal}\n`,
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
