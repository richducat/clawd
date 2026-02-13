#!/usr/bin/env node
/**
 * Find Zoho Leads that might qualify for a Cutaneous Lupus Erythematosus (CLE) study by scanning:
 * - related Notes (Note_Content)
 * - related Attachments filenames
 *
 * Outputs:
 *  - memory/opendoor/lupus-cle-leads-<date>.csv
 *  - memory/opendoor/lupus-cle-leads-<date>.json
 *
 * Usage:
 *   node scripts/tyfys/find-lupus-cle-leads.mjs --days 3650 --pages 20 --perPage 200
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmGet } from '../lib/zoho.mjs';

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

const perPage = Number(getArg('--perPage', '200'));
const pages = Number(getArg('--pages', '10')); // safety cap
const maxLeads = Number(getArg('--maxLeads', String(perPage * pages)));
const days = Number(getArg('--days', '3650'));

const outDir = path.resolve('memory/opendoor');
const outBase = `lupus-cle-leads-${new Date().toISOString().slice(0, 10)}`;
const outCsv = path.join(outDir, `${outBase}.csv`);
const outJson = path.join(outDir, `${outBase}.json`);

const KEYWORDS = [
  // diagnosis
  'lupus',
  'cutaneous lupus',
  'cutaneous lupus erythematosus',
  'cle',
  'discoid lupus',
  'dle',
  // symptoms
  'lesion',
  'lesions',
  'rash',
  'rashes',
  'sores',
  // meds
  'plaquenil',
  'hydroxychloroquine',
  'antimalarial',
  // doc hints
  'biopsy',
  'histology',
];

function norm(s) {
  return String(s || '').toLowerCase();
}

function matchKeywords(text) {
  const t = norm(text);
  if (!t) return [];
  const hits = [];
  for (const k of KEYWORDS) {
    if (t.includes(k)) hits.push(k);
  }
  return hits;
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[\n\r,\"]/g.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function listLeadsPage({ accessToken, page }) {
  const fields = [
    'id',
    'Full_Name',
    'First_Name',
    'Last_Name',
    'Email',
    'Phone',
    'Mobile',
    'Owner',
    'Created_Time',
    'Modified_Time',
    'Lead_Status',
  ].join(',');

  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const sinceYmd = since.toISOString().slice(0, 10);
  const criteria = `(Modified_Time:after:${sinceYmd})`;

  const pathAndQuery = `/crm/v2/Leads?fields=${encodeURIComponent(fields)}&page=${page}&per_page=${perPage}&criteria=${encodeURIComponent(criteria)}`;
  const res = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery });
  return {
    leads: res?.data || [],
    info: res?.info || {},
  };
}

async function fetchLeadNotes({ accessToken, leadId }) {
  const pathAndQuery = `/crm/v2/Leads/${leadId}/Notes?per_page=200&page=1`;
  const res = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery }).catch(() => null);
  return res?.data || [];
}

async function fetchLeadAttachments({ accessToken, leadId }) {
  const pathAndQuery = `/crm/v2/Leads/${leadId}/Attachments?per_page=200&page=1`;
  const res = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery }).catch(() => null);
  return res?.data || [];
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const token = await getZohoAccessToken();
  const results = [];

  let seen = 0;
  for (let page = 1; page <= pages; page += 1) {
    const { leads, info } = await listLeadsPage({ accessToken: token, page });
    if (!leads.length) break;

    for (const lead of leads) {
      if (seen >= maxLeads) break;
      seen += 1;

      const leadId = String(lead.id);
      const name = lead.Full_Name || [lead.First_Name, lead.Last_Name].filter(Boolean).join(' ') || '';

      const notes = await fetchLeadNotes({ accessToken: token, leadId });
      const atts = await fetchLeadAttachments({ accessToken: token, leadId });

      const noteHits = [];
      for (const n of notes) {
        const body = n?.Note_Content || '';
        const hits = matchKeywords(body);
        if (hits.length) {
          noteHits.push({ hits, snippet: String(body).slice(0, 220).replace(/\s+/g, ' ').trim() });
        }
      }

      const attHits = [];
      for (const a of atts) {
        const fileName = a?.File_Name || a?.file_name || '';
        const hits = matchKeywords(fileName);
        if (hits.length) {
          attHits.push({ hits, fileName });
        }
      }

      if (noteHits.length || attHits.length) {
        const allHits = new Set();
        for (const x of [...noteHits, ...attHits]) for (const h of x.hits) allHits.add(h);

        results.push({
          leadId,
          name,
          owner: lead?.Owner?.name || '',
          email: lead?.Email || '',
          phone: lead?.Phone || lead?.Mobile || '',
          leadStatus: lead?.Lead_Status || '',
          createdTime: lead?.Created_Time || '',
          modifiedTime: lead?.Modified_Time || '',
          keywords: [...allHits].sort(),
          noteHits,
          attHits,
        });
      }

      if (seen % 25 === 0) process.stdout.write(`scanned ${seen} leads... matches=${results.length}\n`);
    }

    if (seen >= maxLeads) break;
    if (info?.more_records !== true) break;
  }

  await fs.writeFile(outJson, JSON.stringify({
    generatedAt: new Date().toISOString(),
    pages,
    perPage,
    maxLeads,
    days,
    keywords: KEYWORDS,
    count: results.length,
    results,
  }, null, 2) + '\n', 'utf8');

  const header = [
    'leadId','name','owner','email','phone','leadStatus','createdTime','modifiedTime','keywords','noteHitCount','attachmentHitCount','exampleNoteSnippet','exampleAttachment',
  ];

  const lines = [header.join(',')];
  for (const r of results) {
    lines.push([
      r.leadId,
      r.name,
      r.owner,
      r.email,
      r.phone,
      r.leadStatus,
      r.createdTime,
      r.modifiedTime,
      (r.keywords || []).join('|'),
      String(r.noteHits?.length || 0),
      String(r.attHits?.length || 0),
      r.noteHits?.[0]?.snippet || '',
      r.attHits?.[0]?.fileName || '',
    ].map(csvEscape).join(','));
  }

  await fs.writeFile(outCsv, lines.join('\n') + '\n', 'utf8');

  process.stdout.write(`\nDONE\nmatched_leads=${results.length}\njson=${outJson}\ncsv=${outCsv}\n`);
}

await main();
