#!/usr/bin/env node
/**
 * RingCentral OAuth re-authorization helper
 *
 * Generates an authorization URL for the configured RingCentral app,
 * then exchanges the returned `code` for access+refresh tokens.
 *
 * You must:
 *  1) open the printed URL in a browser (logged into RingCentral)
 *  2) approve
 *  3) copy the `code` query param from the redirect URL
 *  4) run this script again with --code <CODE>
 *
 * It will update:
 *  - .env.local (RINGCENTRAL_REFRESH_TOKEN)
 *  - memory/ringcentral-token.json (full token payload)
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

function basicAuthHeader(id, secret) {
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

const apiServer = process.env.RINGCENTRAL_API_SERVER || 'https://platform.ringcentral.com';
const clientId = reqEnv('RINGCENTRAL_CLIENT_ID');
const clientSecret = reqEnv('RINGCENTRAL_CLIENT_SECRET');
const redirectUri = process.env.RINGCENTRAL_REDIRECT_URI || 'http://localhost:5173/ringcentral/callback';

const code = getArg('--code', null);

const CACHE_PATH = path.resolve('memory/ringcentral-token.json');
const ENV_PATH = path.resolve('.env.local');

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

async function exchangeCodeForToken(authCode) {
  const url = `${apiServer}/restapi/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authCode,
    redirect_uri: redirectUri,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`RingCentral code exchange failed (${res.status}): ${json?.error || ''} ${json?.error_description || JSON.stringify(json)}`);
  }

  const expiresAtMs = Date.now() + (Number(json.expires_in) || 3600) * 1000;
  return { ...json, expires_at_ms: expiresAtMs, obtained_at_ms: Date.now() };
}

(async function main() {
  if (!code) {
    const state = `tyfys-${Date.now()}`;
    const authUrl = new URL(`${apiServer}/restapi/oauth/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);

    console.log('Open this URL in your browser and approve:');
    console.log(authUrl.toString());
    console.log('\nThen run:');
    console.log('  node scripts/tyfys/ringcentral-oauth-refresh-token.mjs --code <PASTE_CODE>');
    return;
  }

  const token = await exchangeCodeForToken(code);
  if (!token.refresh_token) throw new Error('No refresh_token returned. Ensure Offline Access is enabled and scopes include it.');

  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(token, null, 2) + '\n', 'utf8');
  await patchEnvLocal('RINGCENTRAL_REFRESH_TOKEN', token.refresh_token);

  console.log('✅ Updated RINGCENTRAL_REFRESH_TOKEN in .env.local and wrote memory/ringcentral-token.json');
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
