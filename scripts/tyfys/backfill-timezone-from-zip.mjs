#!/usr/bin/env node
/**
 * TYFYS: Backfill Time Zone field for Leads + Deals from ZIP code.
 *
 * Uses external lookups:
 *   ZIP -> lat/long via https://api.zippopotam.us/us/<zip>
 *   lat/long -> IANA tz via https://timeapi.io/api/TimeZone/coordinate
 * Then maps IANA tz -> simple picklist values:
 *   Eastern (EST), Central (CST), Mountain (MST), Pacific (PST), Alaska (AST ), Hawaii (HST)
 *
 * Modules + fields:
 *   Leads: Zip_Code (text), Time_Zone (picklist)
 *   Deals: Zip_code (text), TimeZone (picklist)
 *
 * Usage:
 *   node scripts/tyfys/backfill-timezone-from-zip.mjs --days 365 --limit 200
 *   node scripts/tyfys/backfill-timezone-from-zip.mjs --module Leads --days 90 --limit 200
 *   node scripts/tyfys/backfill-timezone-from-zip.mjs --module Deals --days 90 --limit 200
 *   node scripts/tyfys/backfill-timezone-from-zip.mjs --dry-run
 *
 * Notes:
 * - COQL returns max 200 per query. Run multiple times to chew through backlog.
 * - Uses a cache (memory/zip-timezone-cache.json) to avoid repeated lookups.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmGet, zohoCrmPut } from '../lib/zoho.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const dryRun = process.argv.includes('--dry-run');
const moduleArg = getArg('--module', 'both'); // Leads|Deals|both
const days = Number(getArg('--days', '365'));
const limit = Math.min(200, Number(getArg('--limit', '200')));
const sleepMs = Number(getArg('--sleepMs', '250'));

const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

const CACHE_PATH = path.resolve('memory/zip-timezone-cache.json');

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
  } catch {
    return { zips: {} };
  }
}

async function writeCache(cache) {
  if (dryRun) return;
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function zip5(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

function mapIanaToPicklist(iana) {
  const s = String(iana || '');
  if (!s) return null;

  // We map by major metro names used in IANA zones.
  if (s.includes('America/New_York') || s.includes('America/Detroit') || s.includes('America/Indiana')) return 'Eastern (EST)';
  if (s.includes('America/Chicago')) return 'Central (CST)';
  if (s.includes('America/Denver') || s.includes('America/Phoenix')) return 'Mountain (MST)';
  if (s.includes('America/Los_Angeles')) return 'Pacific (PST)';
  if (s.includes('America/Anchorage')) return 'Alaska (AST )';
  if (s.includes('Pacific/Honolulu')) return 'Hawaii (HST)';

  return null;
}

async function lookupTimezoneForZip(zip, cache) {
  if (cache.zips?.[zip]?.picklist) return cache.zips[zip].picklist;

  // ZIP -> lat/long
  const zUrl = `https://api.zippopotam.us/us/${zip}`;
  const zRes = await fetch(zUrl);
  if (!zRes.ok) {
    cache.zips[zip] = { error: `zippopotam:${zRes.status}`, updatedAt: new Date().toISOString() };
    return null;
  }
  const zJson = await zRes.json().catch(() => null);
  const place = zJson?.places?.[0];
  const lat = place?.latitude;
  const lon = place?.longitude;
  if (!lat || !lon) {
    cache.zips[zip] = { error: 'zippopotam:no-coords', updatedAt: new Date().toISOString() };
    return null;
  }

  // lat/long -> IANA tz
  const tUrl = `https://timeapi.io/api/TimeZone/coordinate?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`;
  const tRes = await fetch(tUrl);
  if (!tRes.ok) {
    cache.zips[zip] = { error: `timeapi:${tRes.status}`, updatedAt: new Date().toISOString() };
    return null;
  }
  const tJson = await tRes.json().catch(() => null);
  const iana = tJson?.timeZone;
  const pick = mapIanaToPicklist(iana);

  cache.zips[zip] = {
    zip,
    latitude: lat,
    longitude: lon,
    iana,
    picklist: pick,
    updatedAt: new Date().toISOString(),
  };

  return pick;
}

function sinceIsoZohoOffset(daysBack) {
  return new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

function sinceIsoZohoZ(daysBack) {
  // Some modules/queries in this Zoho org accept the Z form more reliably.
  return new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function coqlFetch({ token, module }) {
  const sinceIsoDeals = sinceIsoZohoOffset(days);
  const sinceIsoLeads = sinceIsoZohoZ(days);

  if (module === 'Leads') {
    // NOTE: Leads COQL in this org rejects Modified_Time; use Created_Time for windowing.
    const q = `select id, Zip_Code, Time_Zone, Created_Time from Leads where Last_Name is not null and (Created_Time >= '${sinceIsoLeads}' and Zip_Code != null) limit ${limit}`;
    const res = await zohoCrmCoql({ accessToken: token, apiDomain, selectQuery: q });
    const rows = res?.data || [];
    return rows.filter(r => {
      const v = r.Time_Zone;
      return v == null || String(v) === '' || String(v) === '-None-';
    });
  }

  if (module === 'Deals') {
    const q = `select id, Deal_Name, Zip_code, TimeZone, Modified_Time from Deals where Stage in ('Intake (Document Collection)','Ready for Provider','Sent to Provider') and (Modified_Time >= '${sinceIsoDeals}' and Zip_code != null) limit ${limit}`;
    const res = await zohoCrmCoql({ accessToken: token, apiDomain, selectQuery: q });
    const rows = res?.data || [];
    return rows.filter(r => {
      const v = r.TimeZone;
      return v == null || String(v) === '' || String(v) === '-None-';
    });
  }

  throw new Error(`Unknown module ${module}`);
}

async function updateRecord({ token, module, id, tzPick }) {
  const field = module === 'Leads' ? 'Time_Zone' : 'TimeZone';
  const payload = { data: [{ id, [field]: tzPick }] };
  if (dryRun) {
    process.stdout.write(`[dry-run] update ${module} ${id} ${field}=${tzPick}\n`);
    return;
  }
  await zohoCrmPut({ accessToken: token, apiDomain, path: `/crm/v2/${module}`, json: payload });
}

async function runForModule(mod) {
  const token = await getZohoAccessToken();
  const cache = await readCache();

  const rows = await coqlFetch({ token, module: mod });
  process.stdout.write(`\n=== ${mod} backfill ===\n`);
  process.stdout.write(`candidates=${rows.length} (days=${days}, limit=${limit})${dryRun ? ' DRY_RUN' : ''}\n`);

  let updated = 0;
  let skippedNoZip = 0;
  let skippedNoMap = 0;

  for (const r of rows) {
    const id = String(r.id);
    const z = zip5(mod === 'Leads' ? r.Zip_Code : r.Zip_code);
    if (!z) {
      skippedNoZip += 1;
      continue;
    }

    const tzPick = await lookupTimezoneForZip(z, cache);
    await writeCache(cache);

    if (!tzPick) {
      skippedNoMap += 1;
      continue;
    }

    await updateRecord({ token, module: mod, id, tzPick });
    updated += 1;

    // be nice to APIs
    await sleep(sleepMs);
  }

  process.stdout.write(`updated=${updated} skipped_no_zip=${skippedNoZip} skipped_no_map=${skippedNoMap}\n`);
}

// Add zohoCrmPut helper in case older zoho.mjs doesn't export it.
// (We import it above; this will throw early if missing.)

(async function main() {
  if (moduleArg === 'Leads' || moduleArg === 'both') await runForModule('Leads');
  if (moduleArg === 'Deals' || moduleArg === 'both') await runForModule('Deals');

  process.stdout.write('\nDONE\n');
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
