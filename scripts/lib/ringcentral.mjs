import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE_PATH = path.resolve('memory/ringcentral-token.json');
const ENV_PATH = path.resolve('.env.local');

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
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

async function patchEnvLocal(key, value) {
  // Best-effort: update .env.local in-place so future runs use the latest refresh token.
  try {
    const raw = await fs.readFile(ENV_PATH, 'utf8');
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
  } catch {
    // ignore
  }
}

export async function ringcentralRefreshToken({ refreshToken }) {
  const apiServer = process.env.RINGCENTRAL_API_SERVER || 'https://platform.ringcentral.com';
  const clientId = reqEnv('RINGCENTRAL_CLIENT_ID');
  const clientSecret = reqEnv('RINGCENTRAL_CLIENT_SECRET');

  const url = `${apiServer}/restapi/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
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
    throw new Error(`RingCentral token refresh failed (${res.status}): ${json?.error || ''} ${json?.error_description || JSON.stringify(json)}`);
  }

  const expiresAtMs = Date.now() + (Number(json.expires_in) || 3600) * 1000;
  return {
    ...json,
    expires_at_ms: expiresAtMs,
    obtained_at_ms: Date.now(),
  };
}

export async function ringcentralGetAccessToken() {
  // 1) Use cached access token if valid
  const cache = await readCache();
  if (cache?.access_token && cache?.expires_at_ms && cache.expires_at_ms - Date.now() > 60_000) {
    return cache.access_token;
  }

  // 2) Refresh using the most recent refresh token we can find.
  const envRefresh = process.env.RINGCENTRAL_REFRESH_TOKEN;
  const refreshToken = cache?.refresh_token || envRefresh;
  if (!refreshToken) throw new Error('Missing RINGCENTRAL_REFRESH_TOKEN');

  const refreshed = await ringcentralRefreshToken({ refreshToken });

  // Persist refresh token rotation if present.
  if (refreshed.refresh_token && refreshed.refresh_token !== envRefresh) {
    await patchEnvLocal('RINGCENTRAL_REFRESH_TOKEN', refreshed.refresh_token);
    process.env.RINGCENTRAL_REFRESH_TOKEN = refreshed.refresh_token;
  }

  await writeCache(refreshed);
  return refreshed.access_token;
}

async function ringcentralRequestJson({ method, pathAndQuery, body }) {
  const apiServer = process.env.RINGCENTRAL_API_SERVER || 'https://platform.ringcentral.com';

  async function doFetch() {
    const token = await ringcentralGetAccessToken();
    const url = `${apiServer}${pathAndQuery}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }

  let { res, json } = await doFetch();

  // If our cached access token was revoked (common when re-authorizing), retry once with a fresh refresh.
  if (res.status === 401 && String(json?.message || '').includes('Token not found')) {
    try {
      await fs.unlink(CACHE_PATH);
    } catch {}
    ;({ res, json } = await doFetch());
  }

  if (!res.ok) {
    throw new Error(`RingCentral ${method} ${pathAndQuery} failed (${res.status}): ${json?.message || JSON.stringify(json)}`);
  }

  return json;
}

export async function ringcentralGetJson(pathAndQuery) {
  return ringcentralRequestJson({ method: 'GET', pathAndQuery });
}

export async function ringcentralPostJson(pathAndQuery, body) {
  return ringcentralRequestJson({ method: 'POST', pathAndQuery, body });
}

export async function ringcentralSendSms({ fromNumber, toNumber, text }) {
  if (!fromNumber) throw new Error('ringcentralSendSms: missing fromNumber');
  if (!toNumber) throw new Error('ringcentralSendSms: missing toNumber');
  if (!text) throw new Error('ringcentralSendSms: missing text');

  return ringcentralPostJson('/restapi/v1.0/account/~/extension/~/sms', {
    from: { phoneNumber: fromNumber },
    to: [{ phoneNumber: toNumber }],
    text,
  });
}
