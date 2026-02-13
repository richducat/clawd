#!/usr/bin/env node
/**
 * Find Zoho Deals (clients) that might qualify for a Cutaneous Lupus Erythematosus (CLE) study.
 * Uses COQL over Notes + Attachments, then resolves Parent_Id -> Deals.
 *
 * Output:
 *  - memory/opendoor/lupus-cle-deals-<date>.csv
 *  - memory/opendoor/lupus-cle-deals-<date>.json
 *
 * Usage:
 *   node scripts/tyfys/find-lupus-cle-deals-coql.mjs --days 3650
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
const maxNoteRowsPerKeyword = Number(getArg('--maxNoteRowsPerKeyword', '800'));
const maxAttachmentRowsPerKeyword = Number(getArg('--maxAttachmentRowsPerKeyword', '800'));

const outDir = path.resolve('memory/opendoor');
const outBase = `lupus-cle-deals-${new Date().toISOString().slice(0, 10)}`;
const outCsv = path.join(outDir, `${outBase}.csv`);
const outJson = path.join(outDir, `${outBase}.json`);

const KEYWORDS = [
  'lupus',
  'cutaneous lupus',
  'cutaneous lupus erythematosus',
  'cle',
  'discoid lupus',
  'dle',
  'lesion',
  'lesions',
  'rash',
  'rashes',
  'sores',
  'plaquenil',
  'hydroxychloroquine',
  'antimalarial',
  'biopsy',
  'histology',
];

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[\n\r,\"]/g.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoNoMs(d) {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function escLike(s) {
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

async function resolveDealsByIds({ accessToken, ids }) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));

  const deals = [];
  const fields = [
    'id',
    'Deal_Name',
    'Stage',
    'Owner',
    'Created_Time',
    'Modified_Time',
    'Email_Address',
    'Phone_Number',
  ].join(',');

  for (const c of chunks) {
    const pathAndQuery = `/crm/v2/Deals?ids=${encodeURIComponent(c.join(','))}&fields=${encodeURIComponent(fields)}`;
    const res = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery }).catch(() => null);
    if (res?.data?.length) deals.push(...res.data);
  }

  return deals;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const accessToken = await getZohoAccessToken();
  const sinceIso = isoNoMs(Date.now() - days * 24 * 3600 * 1000);

  const parentToEvidence = new Map();

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
  process.stdout.write(`\nCollected unique parentIds=${parentIds.length}. Resolving which are Deals...\n`);

  const deals = await resolveDealsByIds({ accessToken, ids: parentIds });
  const dealMap = new Map(deals.map(d => [String(d.id), d]));

  const matched = [];
  for (const [pid, ev] of parentToEvidence.entries()) {
    const deal = dealMap.get(String(pid));
    if (!deal) continue;

    const allKw = new Set([...(ev.noteKeywords || []), ...(ev.attachmentKeywords || [])]);

    matched.push({
      dealId: String(pid),
      dealName: deal?.Deal_Name || '',
      owner: deal?.Owner?.name || '',
      stage: deal?.Stage || '',
      email: deal?.Email_Address || '',
      phone: deal?.Phone_Number || '',
      createdTime: deal?.Created_Time || '',
      modifiedTime: deal?.Modified_Time || '',
      keywords: [...allKw].sort(),
      noteEvidence: (ev.notes || []).slice(0, 5),
      attachmentEvidence: (ev.attachments || []).slice(0, 5),
    });
  }

  matched.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));

  await fs.writeFile(outJson, JSON.stringify({
    generatedAt: new Date().toISOString(),
    days,
    keywords: KEYWORDS,
    counts: {
      parentIds: parentIds.length,
      dealsResolved: deals.length,
      matchedDeals: matched.length,
    },
    matched,
  }, null, 2) + '\n', 'utf8');

  const header = ['dealId','dealName','owner','stage','email','phone','createdTime','modifiedTime','keywords','exampleNote','exampleAttachment'];
  const lines = [header.join(',')];
  for (const r of matched) {
    lines.push([
      r.dealId,
      r.dealName,
      r.owner,
      r.stage,
      r.email,
      r.phone,
      r.createdTime,
      r.modifiedTime,
      (r.keywords || []).join('|'),
      r.noteEvidence?.[0]?.snippet || '',
      r.attachmentEvidence?.[0]?.fileName || '',
    ].map(csvEscape).join(','));
  }
  await fs.writeFile(outCsv, lines.join('\n') + '\n', 'utf8');

  process.stdout.write(`\nDONE\nmatchedDeals=${matched.length}\njson=${outJson}\ncsv=${outCsv}\n`);
}

await main();
