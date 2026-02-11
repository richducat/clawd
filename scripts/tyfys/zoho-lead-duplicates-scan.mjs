#!/usr/bin/env node
/**
 * Zoho duplicate lead scan (TYFYS)
 *
 * Goals:
 * - Find duplicate leads by Email / Phone / Mobile.
 * - Find leads that appear to already be a signed client (has Contact or Deal).
 *
 * Output:
 * - Writes JSON report to memory/tyfys-duplicate-leads-report.json
 * - Prints a concise summary.
 *
 * Usage:
 *   node scripts/tyfys/zoho-lead-duplicates-scan.mjs --limit 2000
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql } from '../lib/zoho.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
// Zoho COQL LIMIT is capped (often 200). Keep it safe by default.
const limit = Math.min(Number(getArg('--limit', '200')), 200);

const OUT_PATH = path.resolve('memory/tyfys-duplicate-leads-report.json');

function normalizePhone(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return s;
}

function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    if (!k) continue;
    const a = m.get(k) || [];
    a.push(it);
    m.set(k, a);
  }
  return m;
}

async function main() {
  const accessToken = await getZohoAccessToken();

  // Pull a large-ish slice of leads. We’ll sort/group locally.
  const qLeads = `select id, First_Name, Last_Name, Email, Phone, Mobile, Lead_Status, Created_Time, Owner from Leads where id is not null order by Created_Time desc limit ${limit}`;
  const leadsRes = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: qLeads });
  const leads = Array.isArray(leadsRes?.data) ? leadsRes.data : [];

  const leadsNorm = leads.map(l => ({
    id: String(l.id),
    name: `${l.First_Name || ''} ${l.Last_Name || ''}`.trim(),
    email: normEmail(l.Email),
    phone: normalizePhone(l.Phone),
    mobile: normalizePhone(l.Mobile),
    status: l.Lead_Status,
    owner: l.Owner?.name,
    created: l.Created_Time,
  }));

  const byEmail = groupBy(leadsNorm, l => l.email);
  const byPhone = groupBy(leadsNorm, l => l.phone);
  const byMobile = groupBy(leadsNorm, l => l.mobile);

  const dupEmail = [...byEmail.entries()].filter(([, v]) => v.length >= 2).map(([k, v]) => ({ key: k, leads: v }));
  const dupPhone = [...byPhone.entries()].filter(([, v]) => v.length >= 2).map(([k, v]) => ({ key: k, leads: v }));
  const dupMobile = [...byMobile.entries()].filter(([, v]) => v.length >= 2).map(([k, v]) => ({ key: k, leads: v }));

  // “Already signed up” heuristic:
  // If a lead email or phone appears on a Contact OR a Deal, flag it.
  // We do targeted lookups for each unique email/phone (bounded by limit).
  const uniqueEmails = [...new Set(leadsNorm.map(l => l.email).filter(Boolean))].slice(0, 200);
  const uniquePhones = [...new Set(leadsNorm.flatMap(l => [l.phone, l.mobile]).filter(Boolean))].slice(0, 200);

  async function coqlAll(selectQuery) {
    const r = await zohoCrmCoql({ accessToken, apiDomain, selectQuery });
    return Array.isArray(r?.data) ? r.data : [];
  }

  function esc(s) {
    return String(s || '').replace(/'/g, "\\'");
  }

  function chunks(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // Contacts by email (batched)
  const contactsByEmail = new Map();
  for (const batch of chunks(uniqueEmails, 25)) {
    const inList = batch.map(e => `'${esc(e)}'`).join(',');
    const q = `select id, Full_Name, Email, Phone, Mobile from Contacts where Email in (${inList}) limit 200`;
    const rows = await coqlAll(q);
    for (const row of rows) {
      const key = normEmail(row.Email);
      const cur = contactsByEmail.get(key) || [];
      cur.push(row);
      contactsByEmail.set(key, cur);
    }
  }

  // Deals by email (Email_Address) (batched)
  const dealsByEmail = new Map();
  for (const batch of chunks(uniqueEmails, 25)) {
    const inList = batch.map(e => `'${esc(e)}'`).join(',');
    const q = `select id, Deal_Name, Stage, Email_Address, Phone_Number from Deals where Email_Address in (${inList}) limit 200`;
    const rows = await coqlAll(q);
    for (const row of rows) {
      const key = normEmail(row.Email_Address);
      const cur = dealsByEmail.get(key) || [];
      cur.push(row);
      dealsByEmail.set(key, cur);
    }
  }

  // Deals by phone (Phone_Number) (batched)
  const dealsByPhone = new Map();
  for (const batch of chunks(uniquePhones, 25)) {
    const inList = batch.map(p => `'${esc(p)}'`).join(',');
    const q = `select id, Deal_Name, Stage, Email_Address, Phone_Number from Deals where Phone_Number in (${inList}) limit 200`;
    const rows = await coqlAll(q);
    for (const row of rows) {
      const key = normalizePhone(row.Phone_Number);
      const cur = dealsByPhone.get(key) || [];
      cur.push(row);
      dealsByPhone.set(key, cur);
    }
  }

  const alreadySigned = [];
  for (const l of leadsNorm) {
    const hits = {
      contactsByEmail: l.email ? (contactsByEmail.get(l.email) || []) : [],
      dealsByEmail: l.email ? (dealsByEmail.get(l.email) || []) : [],
      dealsByPhone: [],
    };
    for (const p of [l.phone, l.mobile]) {
      if (!p) continue;
      hits.dealsByPhone.push(...(dealsByPhone.get(p) || []));
    }

    const hasAny = hits.contactsByEmail.length || hits.dealsByEmail.length || hits.dealsByPhone.length;
    if (hasAny) alreadySigned.push({ lead: l, hits });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    limit,
    counts: {
      leads: leadsNorm.length,
      dupEmail: dupEmail.length,
      dupPhone: dupPhone.length,
      dupMobile: dupMobile.length,
      alreadySigned: alreadySigned.length,
    },
    dupEmail,
    dupPhone,
    dupMobile,
    alreadySigned,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');

  process.stdout.write(
    `Done. leads=${leadsNorm.length} dupEmailGroups=${dupEmail.length} dupPhoneGroups=${dupPhone.length} dupMobileGroups=${dupMobile.length} alreadySigned=${alreadySigned.length}\n`,
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
