#!/usr/bin/env node
/**
 * RingCentral OAuth re-authorization helper (tenant-aware)
 *
 * Generates an authorization URL for the configured RingCentral app/tenant,
 * then exchanges the returned `code` for access+refresh tokens.
 *
 * You must:
 *  1) open the printed URL in a browser (logged into RingCentral)
 *  2) approve
 *  3) copy the `code` query param from the redirect URL
 *  4) run this script again with --code <CODE>
 *
 * It will update:
 *  - .env.local (RINGCENTRAL_<TENANT>_REFRESH_TOKEN)
 *  - memory/ringcentral-token.<tenant>.json (full token payload)
 *
 * Usage:
 *   node scripts/tyfys/ringcentral-oauth-refresh-token-tenant.mjs --tenant new
 *   # open URL, approve, copy `code` param
 *   node scripts/tyfys/ringcentral-oauth-refresh-token-tenant.mjs --tenant new --code <CODE>
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

function tenantKey(v) {
  const t = String(v || '').trim();
  return t ? t.toUpperCase() : '';
}

function envName(tenant, base) {
  const t = tenantKey(tenant);
  return t ? `RINGCENTRAL_${t}_${base}` : `RINGCENTRAL_${base}`;
}

const tenant = getArg('--tenant', 'new');
const apiServer = process.env[envName(tenant, 'API_SERVER')] || process.env.RINGCENTRAL_API_SERVER || 'https://platform.ringcentral.com';
const clientId = reqEnv(envName(tenant, 'CLIENT_ID'));
const clientSecret = reqEnv(envName(tenant, 'CLIENT_SECRET'));
const redirectUri = process.env.RINGCENTRAL_REDIRECT_URI || 'http://localhost:5173/ringcentral/callback';

const code = getArg('--code', null);

const ENV_PATH = path.resolve('.env.local');
const CACHE_PATH = path.resolve(`memory/ringcentral-token.${String(tenantKey(tenant) || 'default').toLowerCase()}.json`);

async function patchEnvLocal(key, value) {
  const raw = await fs.readFile(ENV_PATH, 'utf8').catch(() => '');
  const lines = raw.split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  await fs.writeFile(ENV_PATH, out.join('\n'), 'utf8');
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
  const refreshEnvKey = envName(tenant, 'REFRESH_TOKEN');

  if (!code) {
    const state = `tyfys-${tenant}-${Date.now()}`;
    const authUrl = new URL(`${apiServer}/restapi/oauth/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);

    // Force explicit login to avoid approving the wrong extension/user.
    if (!process.argv.includes('--no-prompt-login')) {
      authUrl.searchParams.set('prompt', 'login');
    }

    // Optional: let app-configured scopes apply, unless explicitly provided.
    const scopesEnvKey = envName(tenant, 'SCOPES');
    const scopesRaw = process.env[scopesEnvKey];
    const scopes = scopesRaw ? String(scopesRaw).replace(/^"|"$/g, '').trim() : null;
    if (scopes && !process.argv.includes('--no-scope')) {
      authUrl.searchParams.set('scope', scopes);
    }

    console.log(`RingCentral OAuth (tenant=${tenant})`);
    if (scopes) console.log(`Scopes: ${scopes}`);
    console.log('Open this URL in your browser and approve:');
    console.log(authUrl.toString());
    console.log('\nThen run:');
    console.log(`  node scripts/tyfys/ringcentral-oauth-refresh-token-tenant.mjs --tenant ${tenant} --code <PASTE_CODE>`);
    return;
  }

  const token = await exchangeCodeForToken(code);
  if (!token.refresh_token) throw new Error('No refresh_token returned. Ensure Offline Access is enabled and scopes include it.');

  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(token, null, 2) + '\n', 'utf8');
  await patchEnvLocal(refreshEnvKey, token.refresh_token);

  console.log(`✅ Updated ${refreshEnvKey} in .env.local and wrote ${path.relative(process.cwd(), CACHE_PATH)}`);
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
