#!/usr/bin/env node
/**
 * Fast skin/eczema lead discovery using COQL over Notes + Attachments.
 *
 * Why: fetching Notes/Attachments per-lead is too slow for the whole CRM.
 * This script queries the Notes and Attachments modules directly for keywords,
 * collects Parent_Id IDs, then resolves those IDs to Leads.
 *
 * Output:
 *  - memory/opendoor/skin-leads-<date>.csv
 *  - memory/opendoor/skin-leads-<date>.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmGet } from '../lib/zoho.mjs';

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

const days = Number(getArg('--days', '3650'));
const maxNoteRowsPerKeyword = Number(getArg('--maxNoteRowsPerKeyword', '2000'));
const maxAttachmentRowsPerKeyword = Number(getArg('--maxAttachmentRowsPerKeyword', '2000'));

const outDir = path.resolve('memory/opendoor');
const outBase = `skin-leads-${new Date().toISOString().slice(0, 10)}`;
const outCsv = path.join(outDir, `${outBase}.csv`);
const outJson = path.join(outDir, `${outBase}.json`);

const KEYWORDS = [
  'eczema',
  'atopic dermatitis',
  'dermatitis',
  'skin disease',
  'rash',
  'itch',
  'itching',
  'hives',
  'scar',
  'scars',
  'disfigurement',
  'psoriasis',
  'urticaria',
];

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[\n\r,\"]/g.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function isoNoMs(d) {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function escLike(s) {
  // COQL string literal escape for single quotes.
  return String(s).replace(/'/g, "\\'");
}

async function coqlAll({ accessToken, selectQueryBase, maxRows }) {
  const out = [];
  let offset = 0;
  const pageSize = 200;

  for (;;) {
    const q = `${selectQueryBase} limit ${pageSize} offset ${offset}`;
    const res = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: q });
    const rows = res?.data || [];
    out.push(...rows);

    if (!rows.length) break;
    if (rows.length < pageSize) break;

    offset += pageSize;
    if (out.length >= maxRows) break;
  }

  return out.slice(0, maxRows);
}

async function resolveLeadsByIds({ accessToken, ids }) {
  // Zoho GET supports ids=comma list (max ~100).
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));

  const leads = [];
  const fields = [
    'id',
    'Full_Name',
    'First_Name',
    'Last_Name',
    'Email',
    'Phone',
    'Mobile',
    'Owner',
    'Lead_Status',
    'Created_Time',
    'Modified_Time',
  ].join(',');

  for (const c of chunks) {
    const pathAndQuery = `/crm/v2/Leads?ids=${encodeURIComponent(c.join(','))}&fields=${encodeURIComponent(fields)}`;
    const res = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery }).catch(() => null);
    if (res?.data?.length) leads.push(...res.data);
  }

  return leads;
}

async function main() {
  await ensureDir(outDir);

  const accessToken = await getZohoAccessToken();

  const sinceIso = isoNoMs(Date.now() - days * 24 * 3600 * 1000);

  const parentToEvidence = new Map();

  // 1) Notes scan
  for (const kw of KEYWORDS) {
    const where = `where Note_Content like '%${escLike(kw)}%' and Created_Time >= '${sinceIso}'`;
    const base = `select id, Note_Content, Parent_Id, Created_Time from Notes ${where} order by Created_Time desc`;
    const rows = await coqlAll({ accessToken, selectQueryBase: base, maxRows: maxNoteRowsPerKeyword });

    for (const r of rows) {
      const pid = r?.Parent_Id?.id;
      if (!pid) continue;
      const ev = parentToEvidence.get(pid) || { noteKeywords: new Set(), attachmentKeywords: new Set(), notes: [], attachments: [] };
      ev.noteKeywords.add(kw);
      const snippet = String(r?.Note_Content || '').replace(/\s+/g, ' ').slice(0, 220);
      if (snippet) ev.notes.push({ kw, created: r?.Created_Time, snippet });
      parentToEvidence.set(pid, ev);
    }

    process.stdout.write(`notes kw="${kw}" rows=${rows.length} parents=${parentToEvidence.size}\n`);
  }

  // 2) Attachments scan
  for (const kw of KEYWORDS) {
    const where = `where File_Name like '%${escLike(kw)}%' and Created_Time >= '${sinceIso}'`;
    const base = `select id, File_Name, Parent_Id, Created_Time from Attachments ${where} order by Created_Time desc`;
    const rows = await coqlAll({ accessToken, selectQueryBase: base, maxRows: maxAttachmentRowsPerKeyword });

    for (const r of rows) {
      const pid = r?.Parent_Id?.id;
      if (!pid) continue;
      const ev = parentToEvidence.get(pid) || { noteKeywords: new Set(), attachmentKeywords: new Set(), notes: [], attachments: [] };
      ev.attachmentKeywords.add(kw);
      const fn = String(r?.File_Name || '').slice(0, 240);
      if (fn) ev.attachments.push({ kw, created: r?.Created_Time, fileName: fn });
      parentToEvidence.set(pid, ev);
    }

    process.stdout.write(`attachments kw="${kw}" rows=${rows.length} parents=${parentToEvidence.size}\n`);
  }

  const parentIds = [...parentToEvidence.keys()];
  process.stdout.write(`\nCollected unique parentIds=${parentIds.length}. Resolving which are Leads...\n`);

  // Resolve to leads: try bulk GET; non-leads will just be missing.
  const leads = await resolveLeadsByIds({ accessToken, ids: parentIds });
  const leadMap = new Map(leads.map(l => [String(l.id), l]));

  const matched = [];
  for (const [pid, ev] of parentToEvidence.entries()) {
    const lead = leadMap.get(String(pid));
    if (!lead) continue;

    const name = lead.Full_Name || [lead.First_Name, lead.Last_Name].filter(Boolean).join(' ') || '';
    const allKw = new Set([...(ev.noteKeywords || []), ...(ev.attachmentKeywords || [])]);

    matched.push({
      leadId: String(pid),
      name,
      owner: lead?.Owner?.name || '',
      email: lead?.Email || '',
      phone: lead?.Phone || lead?.Mobile || '',
      leadStatus: lead?.Lead_Status || '',
      createdTime: lead?.Created_Time || '',
      modifiedTime: lead?.Modified_Time || '',
      keywords: [...allKw].sort(),
      noteEvidence: (ev.notes || []).slice(0, 5),
      attachmentEvidence: (ev.attachments || []).slice(0, 5),
    });
  }

  matched.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));

  // Write JSON
  await fs.writeFile(outJson, JSON.stringify({
    generatedAt: new Date().toISOString(),
    days,
    keywords: KEYWORDS,
    counts: {
      parentIds: parentIds.length,
      leadsResolved: leads.length,
      matchedLeads: matched.length,
    },
    matched,
  }, null, 2) + '\n', 'utf8');

  // CSV
  const header = [
    'leadId',
    'name',
    'owner',
    'email',
    'phone',
    'leadStatus',
    'createdTime',
    'modifiedTime',
    'keywords',
    'exampleNote',
    'exampleAttachment',
  ];
  const lines = [header.join(',')];
  for (const r of matched) {
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
      r.noteEvidence?.[0]?.snippet || '',
      r.attachmentEvidence?.[0]?.fileName || '',
    ].map(csvEscape).join(','));
  }

  await fs.writeFile(outCsv, lines.join('\n') + '\n', 'utf8');

  process.stdout.write(`\nDONE\nmatchedLeads=${matched.length}\njson=${outJson}\ncsv=${outCsv}\n`);
}

await main();
