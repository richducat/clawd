import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE_PATH = path.resolve('memory/zoho-token.json');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(status) {
  // Zoho occasionally returns transient errors or throttles.
  return status === 429 || status === 408 || status === 502 || status === 503 || status === 504;
}

function parseRetryAfterMs(res) {
  const ra = res?.headers?.get?.('retry-after');
  if (!ra) return null;
  const sec = Number(ra);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  return null;
}

async function zohoFetchJson(url, { method = 'GET', headers = {}, body } = {}) {
  const maxRetries = Math.max(0, Number(process.env.ZOHO_HTTP_MAX_RETRIES ?? '4'));
  const baseDelayMs = Math.max(50, Number(process.env.ZOHO_HTTP_RETRY_BASE_MS ?? '500'));

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { method, headers, body });
      const json = await res.json().catch(() => ({}));

      if (res.ok) return { res, json };

      // Retry on transient/throttle statuses.
      if (attempt < maxRetries && isRetryableStatus(res.status)) {
        const retryAfterMs = parseRetryAfterMs(res);
        const jitter = Math.floor(Math.random() * 150);
        const delay = retryAfterMs ?? (baseDelayMs * 2 ** attempt + jitter);
        process.stderr.write(`Zoho HTTP retry attempt=${attempt + 1}/${maxRetries} status=${res.status} delayMs=${delay}\n`);
        await sleep(delay);
        continue;
      }

      // Non-retryable or out of retries.
      const msg = json?.message || json?.description || JSON.stringify(json);
      const err = new Error(`Zoho HTTP failed (${res.status}): ${msg}`);
      err.status = res.status;
      err.body = json;
      throw err;
    } catch (e) {
      lastErr = e;
      const isNet = e?.name === 'FetchError' || /network|socket|ECONNRESET|ETIMEDOUT/i.test(String(e?.message || ''));
      if (attempt < maxRetries && isNet) {
        const jitter = Math.floor(Math.random() * 150);
        const delay = baseDelayMs * 2 ** attempt + jitter;
        process.stderr.write(`Zoho HTTP retry attempt=${attempt + 1}/${maxRetries} error=${String(e?.message || e)} delayMs=${delay}\n`);
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }

  throw lastErr || new Error('Zoho HTTP failed (unknown)');
}

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
  const { res, json } = await zohoFetchJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ select_query: selectQuery }),
  });

  // Zoho sometimes returns a 200 with an error payload.
  if (json?.code && json?.message && json?.status === 'error') {
    throw new Error(`Zoho COQL error: ${json.code} ${json.message} (http=${res.status})`);
  }
  return json;
}

export async function zohoCrmGet({ accessToken, apiDomain, pathAndQuery }) {
  const url = `${apiDomain}${pathAndQuery}`;
  const { json } = await zohoFetchJson(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
    },
  });
  return json;
}

export async function zohoCrmPost({ accessToken, apiDomain, path, json }) {
  const url = `${apiDomain}${path}`;
  const { json: out } = await zohoFetchJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(json ?? {}),
  });
  return out;
}

export async function zohoCrmPut({ accessToken, apiDomain, path, json }) {
  const url = `${apiDomain}${path}`;
  const { json: out } = await zohoFetchJson(url, {
    method: 'PUT',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(json ?? {}),
  });
  return out;
}

/**
 * Zoho Bookings (Creator-backed) reports
 *
 * NOTE: The Zoho Bookings UI uses Creator report endpoints like:
 *   https://bookings.zoho.com/api/v2.1/<ownerName>/bookings/report/WEB_APPOINTMENT?...
 * These require Zoho Creator OAuth scopes (e.g., ZohoCreator.report.READ).
 */
export async function zohoBookingsReportGet({ accessToken, ownerName, reportLinkName, query = {} }) {
  if (!ownerName) throw new Error('Missing ownerName for Zoho Bookings');
  if (!reportLinkName) throw new Error('Missing reportLinkName for Zoho Bookings');

  const url = new URL(`https://bookings.zoho.com/api/v2.1/${ownerName}/bookings/report/${reportLinkName}`);
  url.searchParams.set('zc_ownername', ownerName);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }

  const { res, json: out } = await zohoFetchJson(url.toString(), {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/json',
    },
  });

  // creator-style errors can still come back as 200s in some cases; treat explicit codes as failures.
  if (out?.code && (out?.description || out?.message) && out?.status === 'error') {
    throw new Error(`Zoho Bookings report GET error: ${out.code} ${out?.description || out?.message} (http=${res.status})`);
  }

  return out;
}
