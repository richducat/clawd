#!/usr/bin/env node
/**
 * Filter candidate lists (from our Zoho keyword scans) to those within a given radius of a site ZIP.
 *
 * Inputs:
 * - Deals JSON produced by scripts/tyfys/find-*-deals-coql.mjs (expects array at .matched)
 * - Leads JSON produced by scripts/tyfys/find-*-leads.mjs (expects array at .results)
 *
 * This script enriches each record with ZIP + lat/lon (via zippopotam.us) and computes distance miles.
 *
 * Usage:
 *   node scripts/tyfys/filter-candidates-within-radius.mjs \
 *     --siteZip 24060 --radiusMiles 50 \
 *     --dealsJson memory/opendoor/lupus-cle-deals-2026-02-12.json \
 *     --leadsJson memory/opendoor/lupus-cle-leads-2026-02-12.json
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

const siteZip = String(getArg('--siteZip', '24060'));
const radiusMiles = Number(getArg('--radiusMiles', '50'));
const dealsJson = getArg('--dealsJson', '');
const leadsJson = getArg('--leadsJson', '');

if (!dealsJson && !leadsJson) {
  console.error('Provide --dealsJson and/or --leadsJson');
  process.exit(1);
}

const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const cachePath = path.resolve('memory/opendoor/zip-latlon-cache.json');

function toRad(d) { return (d * Math.PI) / 180; }
function havMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return R * c;
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

async function zipToLatLon(zip, cache) {
  const z = String(zip || '').trim();
  if (!z) return null;
  if (cache[z]) return cache[z];

  const url = `https://api.zippopotam.us/us/${encodeURIComponent(z)}`;
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) {
    cache[z] = null;
    return null;
  }
  const json = await res.json().catch(() => null);
  const place = json?.places?.[0];
  const lat = place?.latitude != null ? Number(place.latitude) : null;
  const lon = place?.longitude != null ? Number(place.longitude) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    cache[z] = null;
    return null;
  }
  cache[z] = { lat, lon, place: place['place name'], state: place.state };
  return cache[z];
}

async function fetchDealZips({ accessToken, dealIds }) {
  const chunks = [];
  for (let i = 0; i < dealIds.length; i += 100) chunks.push(dealIds.slice(i, i + 100));

  const out = new Map();
  const fields = ['id', 'Zip_code'].join(',');

  for (const c of chunks) {
    const pathAndQuery = `/crm/v2/Deals?ids=${encodeURIComponent(c.join(','))}&fields=${encodeURIComponent(fields)}`;
    const res = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery }).catch(() => null);
    for (const r of res?.data || []) {
      out.set(String(r.id), r.Zip_code || '');
    }
  }
  return out;
}

async function fetchLeadZips({ accessToken, leadIds }) {
  const chunks = [];
  for (let i = 0; i < leadIds.length; i += 100) chunks.push(leadIds.slice(i, i + 100));

  const out = new Map();
  const fields = ['id', 'Zip_Code'].join(',');

  for (const c of chunks) {
    const pathAndQuery = `/crm/v2/Leads?ids=${encodeURIComponent(c.join(','))}&fields=${encodeURIComponent(fields)}`;
    const res = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery }).catch(() => null);
    for (const r of res?.data || []) {
      out.set(String(r.id), r.Zip_Code || '');
    }
  }
  return out;
}

async function main() {
  const cache = await readJson(cachePath, {});
  const site = await zipToLatLon(siteZip, cache);
  if (!site) throw new Error(`Could not resolve siteZip ${siteZip} to lat/lon`);

  const accessToken = await getZohoAccessToken();

  const out = {
    generatedAt: new Date().toISOString(),
    siteZip,
    radiusMiles,
    site,
    deals: null,
    leads: null,
  };

  if (dealsJson) {
    const dealsIn = JSON.parse(await fs.readFile(dealsJson, 'utf8'));
    const matched = dealsIn?.matched || [];
    const ids = matched.map(d => String(d.dealId)).filter(Boolean);
    const zipMap = await fetchDealZips({ accessToken, dealIds: ids });

    const enriched = [];
    for (const d of matched) {
      const zip = String(zipMap.get(String(d.dealId)) || '').trim();
      const loc = zip ? await zipToLatLon(zip, cache) : null;
      const miles = (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) ? havMiles(site.lat, site.lon, loc.lat, loc.lon) : null;
      enriched.push({ ...d, zip, location: loc, miles });
    }

    const within = enriched.filter(r => r.miles != null && r.miles <= radiusMiles).sort((a,b)=> (a.miles-b.miles));
    out.deals = { total: matched.length, withZip: enriched.filter(r=>r.zip).length, within: within.length, results: within };
  }

  if (leadsJson) {
    const leadsIn = JSON.parse(await fs.readFile(leadsJson, 'utf8'));
    const results = leadsIn?.results || [];
    const ids = results.map(l => String(l.leadId)).filter(Boolean);
    const zipMap = await fetchLeadZips({ accessToken, leadIds: ids });

    const enriched = [];
    for (const l of results) {
      const zip = String(zipMap.get(String(l.leadId)) || '').trim();
      const loc = zip ? await zipToLatLon(zip, cache) : null;
      const miles = (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) ? havMiles(site.lat, site.lon, loc.lat, loc.lon) : null;
      enriched.push({ ...l, zip, location: loc, miles });
    }

    const within = enriched.filter(r => r.miles != null && r.miles <= radiusMiles).sort((a,b)=> (a.miles-b.miles));
    out.leads = { total: results.length, withZip: enriched.filter(r=>r.zip).length, within: within.length, results: within };
  }

  await writeJson(cachePath, cache);

  const outPath = path.resolve(`memory/opendoor/candidates-within-${radiusMiles}mi-of-${siteZip}-${new Date().toISOString().slice(0,10)}.json`);
  await writeJson(outPath, out);

  process.stdout.write(`Wrote ${outPath}\n`);
  process.stdout.write(`Deals: total=${out.deals?.total ?? 0} withZip=${out.deals?.withZip ?? 0} within=${out.deals?.within ?? 0}\n`);
  process.stdout.write(`Leads: total=${out.leads?.total ?? 0} withZip=${out.leads?.withZip ?? 0} within=${out.leads?.within ?? 0}\n`);
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
