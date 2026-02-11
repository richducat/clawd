#!/usr/bin/env node
/**
 * TYFYS RingCentral Inbound SMS Auto-Reply (inbound-only)
 *
 * Purpose:
 * - When a client texts Richard/Devin asking for a status/timeline update,
 *   automatically send a calm, stage-aware reply.
 * - Only triggers if the client texted first (direction=Inbound).
 * - Updates Zoho Deals.Last_Time_Contacted when we reply.
 *
 * Safety rails:
 * - Keyword-gated: only respond to status/timeline check-ins (scope A).
 * - Throttle: max 1 auto-reply per client phone per 24h per line.
 * - STOP/UNSUBSCRIBE -> do not reply (and mark in state).
 *
 * Usage:
 *   node scripts/tyfys/ringcentral-inbound-sms-auto-reply.mjs --dry-run
 *   node scripts/tyfys/ringcentral-inbound-sms-auto-reply.mjs --send
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmPut, zohoCrmPost } from '../lib/zoho.mjs';
import { ringcentralRefreshToken } from '../lib/ringcentral.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

const send = process.argv.includes('--send');
const dryRun = process.argv.includes('--dry-run') || !send;

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const tenant = getArg('--tenant', '');

const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const zohoToken = await getZohoAccessToken();

const STATE_PATH = path.resolve('memory/tyfys-ringcentral-inbound-sms-auto-reply.json');
const TOKENS_PATH = path.resolve('memory/ringcentral-refresh-tokens.json');

// Config (provided by Richard)
const LINE_NUMBERS = {
  richard: '+13212741262',
  devin: '+13212826941',
  adam: '+14072168511',
  amy: '+13212349530',
  jared: '+16822675268',
};

const LOOKBACK_MINUTES = Number(process.env.RC_SMS_LOOKBACK_MINUTES || '30');
const THROTTLE_HOURS = Number(process.env.RC_SMS_THROTTLE_HOURS || '24');

const STAGE_DOCS = 'Intake (Document Collection)';
const STAGE_READY = 'Ready for Provider';
const STAGE_SENT = 'Sent to Provider';

const STOP_WORDS = ['stop', 'unsubscribe', 'cancel texts', 'end'];

const STATUS_KWS = [
  'status',
  'update',
  'any update',
  'updates',
  'timeline',
  'eta',
  'how long',
  'when',
  'heard back',
  'hear back',
  'next',
  'what now',
  'checking in',
  'check in',
  'follow up',
  'followup',
  'still',
  'waiting',
  'appointment',
];

function normalizePhone(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.startsWith('+')) return s;
  const digits = s.replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return s;
}

function escZoho(s) {
  return String(s || '').replace(/'/g, "\\'");
}

function fmtYmdET(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return fallback; }
}

async function writeJson(p, obj) {
  if (dryRun) return;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function tokenKey(userKey) {
  return tenant ? `${tenant}:${userKey}` : userKey;
}

async function loadRefreshTokens() {
  const t = await readJson(TOKENS_PATH, {});
  const needed = ['richard', 'devin', 'adam', 'amy', 'jared'];
  const missing = needed.filter(k => !t?.[tokenKey(k)]);
  if (missing.length) {
    throw new Error(`Missing refresh tokens for ${missing.join(', ')} (tenant=${tenant || 'default'}) in memory/ringcentral-refresh-tokens.json`);
  }
  return t;
}

async function persistRefreshToken({ tokens, userKey, newRefreshToken }) {
  // IMPORTANT: RingCentral refresh tokens are effectively one-time use.
  // Even in --dry-run mode, if we refresh, we MUST persist the rotated refresh token,
  // or the next real run will fail with invalid_grant.
  tokens[tokenKey(userKey)] = newRefreshToken;
  await fs.mkdir(path.dirname(TOKENS_PATH), { recursive: true });
  await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2) + '\n', 'utf8');
}

async function rcRequestJson({ refreshToken, method, pathAndQuery, body, onRefreshTokenRotated }) {
  const apiServer = process.env[(tenant ? `RINGCENTRAL_${tenant.toUpperCase()}_API_SERVER` : '')] || process.env.RINGCENTRAL_API_SERVER || 'https://platform.ringcentral.com';
  const refreshed = await ringcentralRefreshToken({ refreshToken, tenant });

  // RingCentral rotates refresh tokens; persist the newest token so the next run doesn't break.
  if (refreshed?.refresh_token && refreshed.refresh_token !== refreshToken) {
    await onRefreshTokenRotated?.(refreshed.refresh_token);
  }

  const accessToken = refreshed?.access_token;
  if (!accessToken) throw new Error('RingCentral refresh did not return access_token');

  const url = `${apiServer}${pathAndQuery}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RingCentral ${method} ${pathAndQuery} failed (${res.status}): ${json?.message || JSON.stringify(json)}`);
  return json;
}

async function rcSendSms({ refreshToken, fromNumber, toNumber, text, onRefreshTokenRotated }) {
  return rcRequestJson({
    refreshToken,
    method: 'POST',
    pathAndQuery: '/restapi/v1.0/account/~/extension/~/sms',
    body: {
      from: { phoneNumber: fromNumber },
      to: [{ phoneNumber: toNumber }],
      text,
    },
    onRefreshTokenRotated,
  });
}

function msgTextLower(m) {
  const s = String(m?.subject || m?.text || '').trim();
  return s.toLowerCase();
}

function isStopMessage(lower) {
  return STOP_WORDS.some(w => lower === w || lower.includes(` ${w}`) || lower.includes(`${w} `) || lower.includes(w));
}

function looksLikeStatusRequest(lower) {
  // Scope A: only respond to status/timeline-ish messages.
  if (!lower) return false;
  // If it contains any of these keywords, treat as status.
  return STATUS_KWS.some(k => lower.includes(k));
}

function buildSmsReply({ firstName, stage }) {
  const name = firstName ? ` ${firstName}` : '';

  if (stage === STAGE_DOCS) {
    return `Hi${name} — quick update: we’re still actively working on your file. If anything changed on your end (new records/decision letters/symptoms), you can reply here and send it over and we’ll plug it in right away.`;
  }

  if (stage === STAGE_READY || stage === STAGE_SENT) {
    return `Hi${name} — thanks for checking in. We’re still actively working on your case and coordinating the provider side. Some updates can take a few weeks depending on scheduling/availability, but as soon as we have the next actionable update we’ll reach out right away.`;
  }

  // Fallback
  return `Hi${name} — thanks for checking in. We’re still actively working on your case. If anything changed on your end, reply here and send it over and we’ll review ASAP.`;
}

function guessFirstNameFromDealName(dealName) {
  const s = String(dealName || '').trim();
  if (!s) return '';
  const first = s.split(/\s+/)[0];
  if (!first) return '';
  if (first.length > 25) return '';
  return first;
}

async function findMostRelevantDealByPhone({ phone }) {
  const p = normalizePhone(phone);
  if (!p) return null;

  // Zoho stores phone as Phone_Number in Deals.
  // Use a tight query and pick the most recently modified deal.
  const q = `select id, Deal_Name, Stage, Email_Address, Phone_Number, Last_Time_Contacted, Modified_Time from Deals where Phone_Number = '${escZoho(p)}' order by Modified_Time desc limit 5`;
  const res = await zohoCrmCoql({ accessToken: zohoToken, apiDomain, selectQuery: q });
  const deals = res?.data || [];
  if (!deals.length) return null;

  // Prefer deals in our “waiting room” stages first.
  const preferredStages = new Set([STAGE_DOCS, STAGE_READY, STAGE_SENT]);
  const preferred = deals.find(d => preferredStages.has(d.Stage));
  return preferred || deals[0];
}

async function addDealNote({ dealId, content }) {
  const payload = {
    data: [{
      Note_Title: 'Automation',
      Note_Content: content,
      Parent_Id: dealId,
      se_module: 'Deals',
    }],
  };

  if (dryRun) {
    process.stdout.write(`[dry-run] add note deal=${dealId}: ${content.slice(0, 80)}...\n`);
    return;
  }
  await zohoCrmPost({ accessToken: zohoToken, apiDomain, path: '/crm/v2/Notes', json: payload });
}

async function updateLastTimeContacted({ dealId }) {
  const ymd = fmtYmdET(new Date());
  const payload = { data: [{ id: dealId, Last_Time_Contacted: ymd }] };
  if (dryRun) {
    process.stdout.write(`[dry-run] update deal=${dealId} Last_Time_Contacted=${ymd}\n`);
    return;
  }
  await zohoCrmPut({ accessToken: zohoToken, apiDomain, path: '/crm/v2/Deals', json: payload });
}

async function fetchInboundSms({ refreshToken, lookbackMinutes, onRefreshTokenRotated }) {
  const dateFrom = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
  // Note: message-store requires platform v1.0.
  const qs = new URLSearchParams({
    messageType: 'SMS',
    direction: 'Inbound',
    dateFrom,
    perPage: '100',
  });

  const json = await rcRequestJson({
    refreshToken,
    method: 'GET',
    pathAndQuery: `/restapi/v1.0/account/~/extension/~/message-store?${qs.toString()}`,
    onRefreshTokenRotated,
  });

  return Array.isArray(json?.records) ? json.records : [];
}

function extractParticipants(m) {
  const from = normalizePhone(m?.from?.phoneNumber || m?.from?.phoneNumberRaw || '');
  const toList = Array.isArray(m?.to) ? m.to : [];
  const to = normalizePhone(toList[0]?.phoneNumber || '');
  return { from, to };
}

function shouldThrottle({ state, lineKey, clientPhone }) {
  const key = `${lineKey}:${clientPhone}`;
  const last = state.lastAutoReplyAtByClient?.[key];
  if (!last) return false;
  const ms = Date.now() - new Date(last).getTime();
  return ms < THROTTLE_HOURS * 3600_000;
}

async function main() {
  const refreshTokens = await loadRefreshTokens();

  const state = await readJson(STATE_PATH, {
    processed: {},
    lastAutoReplyAtByClient: {},
    optOut: {},
    lastRunAt: null,
  });

  let scanned = 0;
  let considered = 0;
  let replied = 0;
  let skippedNotStatus = 0;
  let skippedThrottle = 0;
  let skippedProcessed = 0;
  let skippedOptOut = 0;
  let skippedNoDeal = 0;
  // NOTE: We fetch message-store using the *extension's* token, so records returned are already scoped
  // to that extension/line. Some records may not include a "to" phoneNumber that matches the public
  // direct line, so we do not gate on it.

  for (const lineKey of ['richard', 'devin', 'adam', 'amy', 'jared']) {
    const refreshToken = refreshTokens[tokenKey(lineKey)];
    const inbound = await fetchInboundSms({
      refreshToken,
      lookbackMinutes: LOOKBACK_MINUTES,
      onRefreshTokenRotated: async (newTok) => persistRefreshToken({ tokens: refreshTokens, userKey: lineKey, newRefreshToken: newTok }),
    });
    scanned += inbound.length;

    // process oldest -> newest
    inbound.sort((a, b) => new Date(a?.creationTime || 0) - new Date(b?.creationTime || 0));

    for (const m of inbound) {
      const id = String(m?.id || '');
      if (!id) continue;
      if (state.processed[id]) { skippedProcessed += 1; continue; }

      const lower = msgTextLower(m);
      const { from: clientPhone } = extractParticipants(m);

      const ourLine = LINE_NUMBERS[lineKey];

      considered += 1;

      if (!clientPhone) {
        state.processed[id] = { at: new Date().toISOString(), lineKey, reason: 'missing_client_phone' };
        continue;
      }

      if (state.optOut[clientPhone] || isStopMessage(lower)) {
        // Do not reply; mark opt-out if stop.
        if (isStopMessage(lower)) state.optOut[clientPhone] = { at: new Date().toISOString(), via: 'inbound_stop' };
        skippedOptOut += 1;
        state.processed[id] = { at: new Date().toISOString(), lineKey, from: clientPhone, reason: 'opt_out' };
        continue;
      }

      if (!looksLikeStatusRequest(lower)) {
        skippedNotStatus += 1;
        state.processed[id] = { at: new Date().toISOString(), lineKey, from: clientPhone, reason: 'not_status' };
        continue;
      }

      if (shouldThrottle({ state, lineKey, clientPhone })) {
        skippedThrottle += 1;
        state.processed[id] = { at: new Date().toISOString(), lineKey, from: clientPhone, reason: 'throttled' };
        continue;
      }

      const deal = await findMostRelevantDealByPhone({ phone: clientPhone });
      if (!deal) {
        skippedNoDeal += 1;
        state.processed[id] = { at: new Date().toISOString(), lineKey, from: clientPhone, reason: 'no_deal_match' };
        continue;
      }

      const dealId = String(deal.id);
      const firstName = guessFirstNameFromDealName(deal.Deal_Name);
      const replyText = buildSmsReply({ firstName, stage: deal.Stage });

      if (dryRun) {
        process.stdout.write(`[dry-run] would SMS reply line=${lineKey} from=${ourLine} to=${clientPhone} deal=${dealId} stage=${deal.Stage}\n`);
      } else {
        await rcSendSms({
          refreshToken,
          fromNumber: ourLine,
          toNumber: clientPhone,
          text: replyText,
          onRefreshTokenRotated: async (newTok) => persistRefreshToken({ tokens: refreshTokens, userKey: lineKey, newRefreshToken: newTok }),
        });
      }

      await addDealNote({ dealId, content: `Inbound SMS received on ${lineKey} line; auto-reply sent. Client: ${clientPhone}.` });
      await updateLastTimeContacted({ dealId });

      state.lastAutoReplyAtByClient[`${lineKey}:${clientPhone}`] = new Date().toISOString();
      state.processed[id] = { at: new Date().toISOString(), lineKey, from: clientPhone, dealId, stage: deal.Stage, replied: true };
      replied += 1;
    }
  }

  state.lastRunAt = new Date().toISOString();
  await writeJson(STATE_PATH, state);

  process.stdout.write(
    `Done. dryRun=${dryRun} scanned=${scanned} considered=${considered} replied=${replied} ` +
    `skipped_not_status=${skippedNotStatus} skipped_throttle=${skippedThrottle} skipped_opt_out=${skippedOptOut} ` +
    `skipped_no_deal=${skippedNoDeal} skipped_processed=${skippedProcessed}\n`,
  );
}

await main();
