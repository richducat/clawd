#!/usr/bin/env node
/**
 * RingCentral OAuth re-authorization helper (per-user refresh token)
 *
 * Same as ringcentral-oauth-refresh-token.mjs, but stores refresh tokens in:
 *   memory/ringcentral-refresh-tokens.json
 * under a chosen key (e.g. richard/devin/adam/amy/jared).
 *
 * Usage:
 *   node scripts/tyfys/ringcentral-oauth-refresh-token-per-user.mjs --user richard
 *   # open URL, approve, copy `code` param
 *   node scripts/tyfys/ringcentral-oauth-refresh-token-per-user.mjs --user richard --code <CODE>
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

const userKey = getArg('--user', null);
const code = getArg('--code', null);

if (!userKey) {
  console.error('Missing --user <key> (e.g. richard, devin)');
  process.exit(1);
}

const TOKENS_PATH = path.resolve('memory/ringcentral-refresh-tokens.json');

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
    throw new Error(
      `RingCentral code exchange failed (${res.status}): ${json?.error || ''} ${json?.error_description || JSON.stringify(json)}`,
    );
  }

  const expiresAtMs = Date.now() + (Number(json.expires_in) || 3600) * 1000;
  return { ...json, expires_at_ms: expiresAtMs, obtained_at_ms: Date.now() };
}

async function readTokens() {
  try {
    return JSON.parse(await fs.readFile(TOKENS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function writeTokens(obj) {
  await fs.mkdir(path.dirname(TOKENS_PATH), { recursive: true });
  await fs.writeFile(TOKENS_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

(async function main() {
  if (!code) {
    const state = `tyfys-${userKey}-${Date.now()}`;

    const noScope = process.argv.includes('--no-scope');

    const scopesEnvKey = envName(tenant, 'SCOPES');
    const scopesRaw =
      process.env[scopesEnvKey] ||
      // Safe defaults for our TYFYS tooling.
      // IMPORTANT: RingCentral's authorize endpoint for this tenant appears to accept
      // human-readable scope labels (with spaces), not the API-style tokens.
      'Read Accounts,Read Call Log,Read Messages,Read Contacts,SMS';

    const raw = String(scopesRaw).replace(/^"|"$/g, '').trim();
    const parts = raw.includes(',') ? raw.split(',') : raw.split(/[\s]+/g);
    const scopes = parts
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ');

    const authUrl = new URL(`${apiServer}/restapi/oauth/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    if (!noScope) authUrl.searchParams.set('scope', scopes);

    // IMPORTANT: prevent RingCentral from reusing an existing browser session for the wrong extension.
    // This forces an explicit login/consent screen.
    if (!process.argv.includes('--no-prompt-login')) {
      authUrl.searchParams.set('prompt', 'login');
    }

    console.log(`RingCentral OAuth for user key: ${userKey}${tenant ? ` (tenant=${tenant})` : ''}`);
    console.log(`Scopes: ${noScope ? '(omitted; use app-configured scopes)' : scopes}`);
    console.log('Open this URL in your browser and approve:');
    console.log(authUrl.toString());
    console.log('\nThen run:');
    console.log(`  node scripts/tyfys/ringcentral-oauth-refresh-token-per-user.mjs --tenant ${tenant || 'new'} --user ${userKey} --code <PASTE_CODE>`);
    return;
  }

  const token = await exchangeCodeForToken(code);
  if (!token.refresh_token) throw new Error('No refresh_token returned. Ensure Offline Access is enabled and scopes include it.');

  const tokens = await readTokens();
  const k = tenant ? `${tenant}:${userKey}` : userKey;
  tokens[k] = token.refresh_token;
  await writeTokens(tokens);

  console.log(`✅ Stored refresh token for ${k} in ${path.relative(process.cwd(), TOKENS_PATH)}`);
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
