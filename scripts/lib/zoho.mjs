import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE_PATH = path.resolve('memory/zoho-token.json');

function getEnv(name, required = true) {
  const v = process.env[name];
  if (required && !v) throw new Error(`Missing env ${name}`);
  return v;
}

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(obj) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export async function getZohoAccessToken() {
  const cache = await readCache();
  if (cache?.access_token && cache?.expires_at_ms && cache.expires_at_ms - Date.now() > 60_000) {
    return cache.access_token;
  }

  const clientId = getEnv('ZOHO_CLIENT_ID');
  const clientSecret = getEnv('ZOHO_CLIENT_SECRET');
  const refreshToken = getEnv('ZOHO_REFRESH_TOKEN');

  // NOTE: Zoho token endpoint lives on accounts.zoho.com even if api domain is zohoapis.com
  const url = 'https://accounts.zoho.com/oauth/v2/token';
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`Zoho refresh failed: ${json.error || res.status} ${json.error_description || JSON.stringify(json)}`);
  }

  const expiresInSec = Number(json.expires_in) || 3600;
  const tokenObj = {
    ...json,
    expires_at_ms: Date.now() + expiresInSec * 1000,
    obtained_at_ms: Date.now(),
  };
  await writeCache(tokenObj);
  return tokenObj.access_token;
}

export async function zohoCrmCoql({ accessToken, apiDomain, selectQuery }) {
  const url = `${apiDomain}/crm/v2/coql`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ select_query: selectQuery }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Zoho COQL failed (${res.status}): ${json?.message || JSON.stringify(json)}`);
  }
  if (json?.code && json?.message && json?.status === 'error') {
    throw new Error(`Zoho COQL error: ${json.code} ${json.message}`);
  }
  return json;
}

export async function zohoCrmGet({ accessToken, apiDomain, pathAndQuery }) {
  const url = `${apiDomain}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Zoho GET failed (${res.status}): ${json?.message || JSON.stringify(json)}`);
  }
  return json;
}

export async function zohoCrmPost({ accessToken, apiDomain, path, json }) {
  const url = `${apiDomain}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(json ?? {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Zoho POST failed (${res.status}): ${out?.message || JSON.stringify(out)}`);
  }
  return out;
}
