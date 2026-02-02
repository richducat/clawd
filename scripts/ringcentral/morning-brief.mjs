#!/usr/bin/env node
/**
 * RingCentral Morning Brief
 *
 * Usage:
 *   node scripts/ringcentral/morning-brief.mjs --hours 24
 *
 * Env:
 *   RINGCENTRAL_API_SERVER (default https://platform.ringcentral.com)
 *   RINGCENTRAL_CLIENT_ID
 *   RINGCENTRAL_CLIENT_SECRET
 *   RINGCENTRAL_REFRESH_TOKEN
 *
 * Token cache (not committed):
 *   memory/ringcentral-token.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnvLocal } from '../lib/load-env-local.mjs';

// Allow running standalone from the repo root.
loadEnvLocal();

const CACHE_PATH = path.resolve('memory/ringcentral-token.json');

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const hours = Number(getArg('--hours', '24'));
const now = new Date();
const from = new Date(now.getTime() - hours * 60 * 60 * 1000);

const RC_API_SERVER = process.env.RINGCENTRAL_API_SERVER || 'https://platform.ringcentral.com';
const CLIENT_ID = process.env.RINGCENTRAL_CLIENT_ID;
const CLIENT_SECRET = process.env.RINGCENTRAL_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.RINGCENTRAL_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('Missing env. Need RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_REFRESH_TOKEN');
  process.exit(1);
}

function basicAuthHeader(id, secret) {
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCache(obj) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function oauthTokenRefresh() {
  const url = `${RC_API_SERVER}/restapi/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: REFRESH_TOKEN,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': basicAuthHeader(CLIENT_ID, CLIENT_SECRET),
    },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${json?.error || ''} ${json?.error_description || JSON.stringify(json)}`);
  }

  // RingCentral may rotate refresh tokens.
  const expiresAtMs = Date.now() + (json.expires_in * 1000);
  return {
    ...json,
    expires_at_ms: expiresAtMs,
    obtained_at_ms: Date.now(),
  };
}

async function getAccessToken() {
  const cache = await readCache();
  if (cache?.access_token && cache?.expires_at_ms) {
    // keep a 60s safety margin
    if (cache.expires_at_ms - Date.now() > 60_000) return { token: cache.access_token, refreshTokenRotatedTo: null };
  }

  const refreshed = await oauthTokenRefresh();
  await writeCache(refreshed);
  const rotated = refreshed.refresh_token && refreshed.refresh_token !== REFRESH_TOKEN ? refreshed.refresh_token : null;
  return { token: refreshed.access_token, refreshTokenRotatedTo: rotated };
}

async function rcGet(accessToken, pathAndQuery) {
  const url = `${RC_API_SERVER}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GET ${pathAndQuery} failed (${res.status}): ${json?.message || JSON.stringify(json)}`);
  }
  return json;
}

function iso(d) {
  return d.toISOString();
}

function safeNum(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function summarizeCallLog(records) {
  const out = {
    total: 0,
    inbound: 0,
    outbound: 0,
    missed: 0,
    voicemail: 0,
    totalDurationSec: 0,
  };

  for (const r of records || []) {
    out.total += 1;
    if (r.direction === 'Inbound') out.inbound += 1;
    if (r.direction === 'Outbound') out.outbound += 1;
    if (r.result === 'Missed') out.missed += 1;
    if (r.type === 'VoiceMail') out.voicemail += 1;
    out.totalDurationSec += safeNum(r.duration);
  }

  return out;
}

function summarizeMessages(records) {
  const out = {
    total: 0,
    sms: 0,
    voicemail: 0,
    fax: 0,
  };

  for (const r of records || []) {
    out.total += 1;
    if (r.type === 'SMS') out.sms += 1;
    if (r.type === 'VoiceMail') out.voicemail += 1;
    if (r.type === 'Fax') out.fax += 1;
  }

  return out;
}

function formatDuration(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${rem}s`;
  return `${rem}s`;
}

function titleLine() {
  // Use local date for the human reading.
  const d = new Date();
  return `RingCentral brief (last ${hours}h) — ${d.toLocaleDateString('en-US')}`;
}

(async function main() {
  const { token, refreshTokenRotatedTo } = await getAccessToken();

  const callLog = await rcGet(
    token,
    `/restapi/v1.0/account/~/extension/~/call-log?dateFrom=${encodeURIComponent(iso(from))}&dateTo=${encodeURIComponent(iso(now))}&perPage=1000`
  );

  const msgs = await rcGet(
    token,
    `/restapi/v1.0/account/~/extension/~/message-store?dateFrom=${encodeURIComponent(iso(from))}&dateTo=${encodeURIComponent(iso(now))}&perPage=1000`
  );

  const callSummary = summarizeCallLog(callLog.records);
  const msgSummary = summarizeMessages(msgs.records);

  const lines = [];
  lines.push(titleLine());
  lines.push('');
  lines.push(`Calls: ${callSummary.total} (in ${callSummary.inbound} / out ${callSummary.outbound} / missed ${callSummary.missed})`);
  lines.push(`Call time: ${formatDuration(callSummary.totalDurationSec)}`);
  lines.push(`Messages: ${msgSummary.total} (SMS ${msgSummary.sms} / VM ${msgSummary.voicemail})`);

  // Small “heads up” section: list last 3 missed inbound callers (if any)
  const missedInbound = (callLog.records || [])
    .filter(r => r.direction === 'Inbound' && r.result === 'Missed')
    .slice(0, 3)
    .map(r => ({
      when: r.startTime,
      from: r.from?.phoneNumber || r.from?.name || 'Unknown',
      to: r.to?.phoneNumber || r.to?.name || 'Unknown',
    }));

  if (missedInbound.length) {
    lines.push('');
    lines.push('Missed inbound (latest 3):');
    for (const m of missedInbound) {
      const when = new Date(m.when).toLocaleString('en-US');
      lines.push(`- ${when}: ${m.from} → ${m.to}`);
    }
  }

  if (refreshTokenRotatedTo) {
    lines.push('');
    lines.push('NOTE: RingCentral rotated the refresh token. Update RINGCENTRAL_REFRESH_TOKEN in .env.local.');
  }

  process.stdout.write(lines.join('\n') + '\n');
})().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
