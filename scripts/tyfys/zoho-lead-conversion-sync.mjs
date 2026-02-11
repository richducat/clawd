#!/usr/bin/env node
/**
 * TYFYS Zoho Lead→Deal conversion sync
 *
 * Problem:
 * - When a Lead is converted to a Deal, Zoho field mapping may be incomplete and
 *   related records (notes/attachments) may not carry over.
 *
 * Goal:
 * - Detect recently converted leads.
 * - For each, locate the converted Deal.
 * - Copy shared fields (where Deal field is empty).
 * - Copy notes from Lead → Deal (idempotent).
 * - Copy attachments from Lead → Deal (best-effort; idempotent).
 * - Log everything to memory/tyfys-lead-conversion-sync.json.
 *
 * Usage:
 *   node scripts/tyfys/zoho-lead-conversion-sync.mjs --hours 48 --dry-run
 *   node scripts/tyfys/zoho-lead-conversion-sync.mjs --hours 168
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmGet, zohoCrmPost, zohoCrmPut } from '../lib/zoho.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const dryRun = process.argv.includes('--dry-run');
const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const hours = Number(getArg('--hours', '48'));
const limit = Math.min(Number(getArg('--limit', '200')), 200);

const STATE_PATH = path.resolve('memory/tyfys-lead-conversion-sync.json');

function isoZoho(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; }
}

async function writeJson(p, obj) {
  if (dryRun) return;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function esc(s) {
  return String(s || '').replace(/'/g, "\\'");
}

async function getModuleFields(module) {
  const token = await getZohoAccessToken();
  const j = await zohoCrmGet({ accessToken: token, apiDomain, pathAndQuery: `/crm/v2/settings/fields?module=${encodeURIComponent(module)}` });
  const fields = j?.fields || [];
  const byApi = new Map();
  for (const f of fields) {
    if (f?.api_name) byApi.set(String(f.api_name), f);
  }
  return byApi;
}

function isSkippableField(apiName) {
  const a = String(apiName || '');
  if (!a) return true;
  const bad = new Set([
    'id',
    'Created_Time',
    'Modified_Time',
    'Created_By',
    'Modified_By',
    'Owner',
    'Tag',
    'Layout',
    'Converted',
    'Converted_Detail',
  ]);
  if (bad.has(a)) return true;
  if (a.startsWith('$')) return true;
  return false;
}

function isEmpty(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

async function fetchRelatedAll({ module, id, rel, perPage = 200, maxPages = 10 }) {
  const token = await getZohoAccessToken();
  let page = 1;
  let out = [];
  for (;;) {
    const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    const j = await zohoCrmGet({ accessToken: token, apiDomain, pathAndQuery: `/crm/v2/${module}/${id}/${rel}?${qs.toString()}` });
    const data = j?.data || [];
    out = out.concat(data);
    if (!j?.info?.more_records) break;
    page += 1;
    if (page > maxPages) break;
  }
  return out;
}

async function addDealNote({ dealId, title, content }) {
  const token = await getZohoAccessToken();
  const payload = {
    data: [{
      Note_Title: title,
      Note_Content: content,
      Parent_Id: dealId,
      se_module: 'Deals',
    }],
  };
  if (dryRun) return;
  await zohoCrmPost({ accessToken: token, apiDomain, path: '/crm/v2/Notes', json: payload });
}

async function updateDeal({ dealId, patch }) {
  const token = await getZohoAccessToken();
  const payload = { data: [{ id: dealId, ...patch }] };
  if (dryRun) return;
  await zohoCrmPut({ accessToken: token, apiDomain, path: '/crm/v2/Deals', json: payload });
}

async function downloadAttachment({ module, id, attachmentId }) {
  const token = await getZohoAccessToken();
  const url = `${apiDomain}/crm/v2/${module}/${id}/Attachments/${attachmentId}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: '*/*',
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`download attachment failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dispo = res.headers.get('content-disposition') || '';
  const m = dispo.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const filenameRaw = decodeURIComponent(m?.[1] || m?.[2] || `attachment-${attachmentId}`);
  return { buf, filename: filenameRaw };
}

async function uploadDealAttachment({ dealId, filename, buf }) {
  const token = await getZohoAccessToken();
  const url = `${apiDomain}/crm/v2/Deals/${dealId}/Attachments`;

  const form = new FormData();
  form.append('file', new Blob([buf]), filename);

  if (dryRun) return;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
    },
    body: form,
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`upload attachment failed (${res.status}): ${out?.message || JSON.stringify(out)}`);
  }
  return out;
}

async function main() {
  const state = await readJson(STATE_PATH, {
    lastRunAt: null,
    processedLeadIds: {},
    processed: [],
  });

  const sinceIso = isoZoho(new Date(Date.now() - hours * 3600 * 1000));
  const token = await getZohoAccessToken();

  // We detect conversions by scanning Deals with Lead_Conversion_Time set recently.
  // Then we best-match the originating Lead by Email/Phone/Mobile.
  // Note: In this org, Lead_Conversion_Time appears to be numeric (not a datetime),
  // so we use Created_Time window + Lead_Conversion_Time not null as our detection.
  const qDeals = `select id, Deal_Name, Lead_Conversion_Time, Email_Address, Phone_Number, Created_Time from Deals where Created_Time >= '${sinceIso}' and Lead_Conversion_Time is not null order by Created_Time desc limit ${limit}`;
  const dealsRes = await zohoCrmCoql({ accessToken: token, apiDomain, selectQuery: qDeals });
  const deals = dealsRes?.data || [];

  // Field intersection cache
  const leadFields = await getModuleFields('Leads');
  const dealFields = await getModuleFields('Deals');
  const shared = [...leadFields.keys()].filter(k => dealFields.has(k) && !isSkippableField(k));

  let scanned = 0;
  let updatedDeals = 0;
  let copiedNotes = 0;
  let copiedAttachments = 0;
  let skippedNoLeadMatch = 0;

  for (const deal of deals) {
    scanned += 1;
    const dealId = String(deal.id);
    if (state.processedLeadIds[dealId]) continue; // (we store by dealId for this workflow)

    const email = String(deal.Email_Address || '').trim();
    const phone = String(deal.Phone_Number || '').trim();
    const convTime = deal.Lead_Conversion_Time;

    // Find a matching lead (prefer Email; fallback phone/mobile). Use Created_Time <= conversion time to bias.
    let leadMatch = null;
    if (email) {
      const q = `select id from Leads where Email = '${esc(email)}' limit 1`;
      const r = await zohoCrmCoql({ accessToken: token, apiDomain, selectQuery: q }).catch(() => ({}));
      leadMatch = r?.data?.[0];
    }
    if (!leadMatch && phone) {
      const p = phone.replace(/\D+/g, '');
      const p10 = p.length >= 10 ? p.slice(-10) : p;
      const variants = [phone, p, p10].filter(Boolean);
      const or = variants.map(v => `(Phone = '${esc(v)}' or Mobile = '${esc(v)}')`).join(' or ');
      const q = `select id from Leads where ${or} limit 1`;
      const r = await zohoCrmCoql({ accessToken: token, apiDomain, selectQuery: q }).catch(() => ({}));
      leadMatch = r?.data?.[0];
    }

    if (!leadMatch && deal.Deal_Name) {
      const dealName = String(deal.Deal_Name).trim();
      const q = `select id from Leads where Full_Name = '${esc(dealName)}' limit 1`;
      const r = await zohoCrmCoql({ accessToken: token, apiDomain, selectQuery: q }).catch(() => ({}));
      leadMatch = r?.data?.[0];
    }

    if (!leadMatch?.id) {
      skippedNoLeadMatch += 1;
      state.processed.push({ at: new Date().toISOString(), dealId, status: 'skipped_no_lead_match', email, phone, convTime });
      state.processedLeadIds[dealId] = { at: new Date().toISOString(), status: 'skipped_no_lead_match' };
      continue;
    }

    const leadId = String(leadMatch.id);

    // Load full records
    const leadFull = (await zohoCrmGet({ accessToken: token, apiDomain, pathAndQuery: `/crm/v2/Leads/${leadId}` }))?.data?.[0];
    const dealFull = (await zohoCrmGet({ accessToken: token, apiDomain, pathAndQuery: `/crm/v2/Deals/${dealId}` }))?.data?.[0];

    // Copy shared fields where Deal is empty.
    const patch = {};
    for (const k of shared) {
      const lv = leadFull?.[k];
      const dv = dealFull?.[k];
      if (!isEmpty(lv) && isEmpty(dv)) {
        patch[k] = lv;
      }
    }

    if (Object.keys(patch).length) {
      await updateDeal({ dealId, patch });
      updatedDeals += 1;
    }

    // Copy notes: Lead → Deal. Idempotent by adding a marker containing leadId+noteId.
    const leadNotes = await fetchRelatedAll({ module: 'Leads', id: leadId, rel: 'Notes' });
    const dealNotes = await fetchRelatedAll({ module: 'Deals', id: dealId, rel: 'Notes' });
    const dealNoteMarkerText = dealNotes.map(n => String(n?.Note_Content || '')).join('\n');

    for (const n of leadNotes) {
      const noteId = String(n?.id || '');
      if (!noteId) continue;
      const marker = `[from_lead:${leadId}:note:${noteId}]`;
      if (dealNoteMarkerText.includes(marker)) continue;

      const title = `Lead note → Deal (${leadId})`;
      const content = `${marker}\n\n${n?.Note_Content || ''}`;
      await addDealNote({ dealId, title, content });
      copiedNotes += 1;
    }

    // Copy attachments best-effort.
    const leadAtts = await fetchRelatedAll({ module: 'Leads', id: leadId, rel: 'Attachments' });
    const dealAtts = await fetchRelatedAll({ module: 'Deals', id: dealId, rel: 'Attachments' });
    const dealAttIds = new Set(dealAtts.map(a => String(a?.id || '')).filter(Boolean));

    for (const a of leadAtts) {
      const attId = String(a?.id || '');
      if (!attId) continue;

      // We can't compare IDs across modules reliably; use a note-marker-based de-dupe.
      const marker = `[from_lead:${leadId}:attachment:${attId}]`;
      if (dealNoteMarkerText.includes(marker)) continue;

      try {
        const { buf, filename } = await downloadAttachment({ module: 'Leads', id: leadId, attachmentId: attId });
        await uploadDealAttachment({ dealId, filename, buf });
        await addDealNote({ dealId, title: 'Lead attachment copied', content: `${marker}\nCopied attachment: ${filename}` });
        copiedAttachments += 1;
      } catch (e) {
        await addDealNote({ dealId, title: 'Lead attachment copy FAILED', content: `${marker}\nError: ${String(e?.message || e)}` });
      }
    }

    state.processedLeadIds[dealId] = { at: new Date().toISOString(), leadId };
    state.processed.push({ at: new Date().toISOString(), leadId, dealId, patchedFields: Object.keys(patch).length });
    await writeJson(STATE_PATH, state);
  }

  state.lastRunAt = new Date().toISOString();
  await writeJson(STATE_PATH, state);

  process.stdout.write(
    `Done. dryRun=${dryRun} scanned=${scanned} convertedDeals=${deals.length} updatedDeals=${updatedDeals} copiedNotes=${copiedNotes} copiedAttachments=${copiedAttachments} skippedNoLeadMatch=${skippedNoLeadMatch}\n`,
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
