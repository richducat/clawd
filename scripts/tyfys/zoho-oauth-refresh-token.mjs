#!/usr/bin/env node
/**
 * Zoho OAuth re-authorization helper
 *
 * This project currently uses Zoho CRM + (now) Zoho Bookings (Creator-backed) APIs.
 * Zoho Bookings endpoints used by the Bookings UI require Zoho Creator scopes.
 *
 * This script:
 *  - prints an authorize URL for the configured Zoho client
 *  - exchanges the returned grant code for a refresh token
 *  - writes/patches .env.local (ZOHO_REFRESH_TOKEN)
 *
 * Usage:
 *   node scripts/tyfys/zoho-oauth-refresh-token.mjs
 *   # open URL, approve, copy `code`
 *   node scripts/tyfys/zoho-oauth-refresh-token.mjs --code <CODE>
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnvLocal } from '../lib/load-env-local.mjs';

loadEnvLocal();

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const clientId = reqEnv('ZOHO_CLIENT_ID');
const clientSecret = reqEnv('ZOHO_CLIENT_SECRET');
const redirectUri = process.env.ZOHO_REDIRECT_URI || 'http://localhost:5173/zoho/callback';

// Union of scopes we need.
// CRM scopes are already in use; Creator scopes are needed for Bookings (Creator-backed reports).
const scope = [
  'ZohoCRM.modules.ALL',
  'ZohoCRM.settings.ALL',
  'ZohoCRM.users.ALL',
  'ZohoCRM.org.ALL',
  'ZohoCRM.coql.READ',
  'ZohoCRM.modules.tasks.ALL',
  // Bookings (Creator-backed)
  'ZohoCreator.report.READ',
  'ZohoCreator.meta.READ',
].join(' ');

const code = getArg('--code', null);

const ENV_PATH = path.resolve('.env.local');
const CACHE_PATH = path.resolve('memory/zoho-refresh-token.json');

async function patchEnvLocal(key, value) {
  const raw = await fs.readFile(ENV_PATH, 'utf8').catch(() => '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  await fs.writeFile(ENV_PATH, out.join('\n') + '\n', 'utf8');
}

async function exchangeCodeForRefreshToken(authCode) {
  const url = 'https://accounts.zoho.com/oauth/v2/token';
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code: authCode,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`Zoho code exchange failed (${res.status}): ${json.error || ''} ${json.error_description || JSON.stringify(json)}`);
  }
  if (!json.refresh_token) {
    throw new Error('No refresh_token returned. In Zoho, refresh_token is typically returned only on the first consent; you may need to add prompt=consent and access_type=offline.');
  }
  return json;
}

(async function main() {
  if (!code) {
    const state = `tyfys-${Date.now()}`;
    const authUrl = new URL('https://accounts.zoho.com/oauth/v2/auth');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    console.log('Open this URL in your browser and approve:');
    console.log(authUrl.toString());
    console.log('\nThen run:');
    console.log('  node scripts/tyfys/zoho-oauth-refresh-token.mjs --code <PASTE_CODE>');
    return;
  }

  const token = await exchangeCodeForRefreshToken(code);

  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(token, null, 2) + '\n', 'utf8');
  await patchEnvLocal('ZOHO_REFRESH_TOKEN', token.refresh_token);

  console.log('✅ Updated ZOHO_REFRESH_TOKEN in .env.local and wrote memory/zoho-refresh-token.json');
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
