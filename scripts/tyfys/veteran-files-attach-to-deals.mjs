/**
 * Attach files from the local Google Drive sync "VETERAN FILES" folders into the matching Zoho Deal.
 *
 * Matching: folder name -> Deals.Deal_Name LIKE '%<name>%'
 * De-dupe: skip if Deal already has an attachment with same File_Name.
 *
 * Usage:
 *   node scripts/tyfys/veteran-files-attach-to-deals.mjs --index memory/tyfys/veteran-files-index.json --limit 25 --dry-run
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmGet } from '../lib/zoho.mjs';

loadEnvLocal();

const args = new Set(process.argv.slice(2));
function argVal(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const indexPath = argVal('--index', 'memory/tyfys/veteran-files-index.json');
const limit = Number(argVal('--limit', '30'));
const dryRun = args.has('--dry-run');

const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

function esc(s) {
  return String(s || '').replace(/'/g, "\\'");
}

function normalizeName(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^\*+/, '').trim();
  s = s.replace(/[“”]/g, '"');

  // Convert "Last, First" -> "First Last"
  const comma = s.match(/^([^,]+),\s*(.+)$/);
  if (comma) s = `${comma[2]} ${comma[1]}`.replace(/\s+/g, ' ').trim();

  // Remove stray punctuation that breaks LIKE matching
  s = s.replace(/[_]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // Drop common suffixes when present
  s = s.replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/gi, '').replace(/\s+/g, ' ').trim();

  return s;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function readFileWithRetry(absPath, { attempts = 6 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fs.readFile(absPath);
    } catch (e) {
      lastErr = e;
      const errno = e?.errno;
      // Google Drive File Stream sometimes throws errno=11 while hydrating.
      if (errno === 11 || String(e?.message || '').includes('Resource deadlock avoided')) {
        await sleep(500 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function uploadDealAttachment({ accessToken, dealId, filename, absPath }) {
  const url = `${apiDomain}/crm/v2/Deals/${dealId}/Attachments`;

  if (dryRun) return { dryRun: true };

  const buf = await readFileWithRetry(absPath);
  const form = new FormData();
  form.append('file', new Blob([buf]), filename);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    body: form,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`upload attachment failed (${res.status}): ${out?.message || JSON.stringify(out)}`);
  return out;
}

async function fetchDealAttachments({ accessToken, dealId }) {
  const r = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery: `/crm/v2/Deals/${dealId}/Attachments?per_page=200&page=1` });
  return r?.data || [];
}

async function findDealByFolderName({ accessToken, folderName }) {
  const raw = String(folderName || '').trim();
  const n1 = normalizeName(raw);
  const n2 = raw.replace(/\s+/g, ' ').trim();
  // Try both normalized and raw (some folders are already First Last)
  const likeA = esc(n1);
  const likeB = esc(n2);
  const q = `select id, Deal_Name, Stage, Email_Address from Deals where (Deal_Name like '%${likeA}%' or Deal_Name like '%${likeB}%') order by Modified_Time desc limit 5`;
  const r = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: q }).catch(() => ({}));
  const data = r?.data || [];
  if (data.length === 1) return data[0];
  if (data.length === 0) return { error: 'no_match', candidates: [] };
  return { error: 'multiple_matches', candidates: data };
}

const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
const accessToken = await getZohoAccessToken();

const onlyNoMatchFrom = argVal('--onlyNoMatchFrom', null);

let onlyNoMatchSet = null;
if (onlyNoMatchFrom) {
  const prev = JSON.parse(await fs.readFile(onlyNoMatchFrom, 'utf8'));
  onlyNoMatchSet = new Set((prev.foldersNoMatch || []).map((x) => String(x.folderName || '').trim()).filter(Boolean));
}

const folders = (index.folders || [])
  .filter((f) => (f.files?.length || 0) > 0)
  .filter((f) => (onlyNoMatchSet ? onlyNoMatchSet.has(String(f.name || '').trim()) : true))
  .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
  .slice(0, limit);

const report = {
  scannedAt: new Date().toISOString(),
  indexPath,
  dryRun,
  folderLimit: limit,
  foldersConsidered: folders.length,
  matchedDeals: 0,
  uploadsAttempted: 0,
  uploadsSucceeded: 0,
  uploadsSkippedAlreadyOnDeal: 0,
  foldersNoMatch: [],
  foldersMultipleMatches: [],
  uploads: [],
};

for (const f of folders) {
  const folderName = f.name;
  const match = await findDealByFolderName({ accessToken, folderName });
  if (match?.error === 'no_match') {
    report.foldersNoMatch.push({ folderName });
    continue;
  }
  if (match?.error === 'multiple_matches') {
    report.foldersMultipleMatches.push({ folderName, candidates: match.candidates });
    continue;
  }

  const dealId = String(match.id);
  report.matchedDeals += 1;

  const existing = await fetchDealAttachments({ accessToken, dealId });
  const existingNames = new Set(existing.map((a) => String(a?.File_Name || '').trim()).filter(Boolean));

  for (const file of f.files) {
    const filename = String(file.name);
    const absPath = path.join(index.root, folderName, file.rel);
    report.uploadsAttempted += 1;

    if (existingNames.has(filename)) {
      report.uploadsSkippedAlreadyOnDeal += 1;
      continue;
    }

    try {
      const out = await uploadDealAttachment({ accessToken, dealId, filename, absPath });
      report.uploadsSucceeded += 1;
      report.uploads.push({ folderName, dealId, filename, absPath, status: 'ok', dryRun: !!out?.dryRun });
    } catch (e) {
      report.uploads.push({ folderName, dealId, filename, absPath, status: 'error', error: String(e?.message || e) });
    }
  }
}

await fs.mkdir(path.resolve('memory/tyfys'), { recursive: true });
const outPath = path.resolve('memory/tyfys/veteran-files-attach-report.json');
await fs.writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`Done. dryRun=${dryRun} folders=${report.foldersConsidered} matchedDeals=${report.matchedDeals} attempted=${report.uploadsAttempted} ok=${report.uploadsSucceeded} skippedExisting=${report.uploadsSkippedAlreadyOnDeal} noMatch=${report.foldersNoMatch.length} multiMatch=${report.foldersMultipleMatches.length}`);
console.log(`Wrote ${outPath}`);
