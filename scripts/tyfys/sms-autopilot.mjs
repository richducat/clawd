#!/usr/bin/env node
/**
 * TYFYS SMS Autopilot (v1)
 *
 * - Uses RingCentral message-store to detect inbound SMS.
 * - Determines whether sender is a Zoho Lead or Deal/Client.
 * - For leads: send Day-N followup sequence from Lead Owner line.
 * - For deals/clients: send from the line they last interacted with (RC history).
 * - Always appends booking link to every message.
 * - Quiet hours: 9pm–8am Pacific (hard-coded for now per Richard).
 *
 * This script is safe-ish but still powerful. It will SEND SMS.
 * Run with --dry-run first.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmGet } from '../lib/zoho.mjs';
import { ringcentralGetJson, ringcentralSendSms } from '../lib/ringcentral.mjs';

loadEnvLocal();

const STATE_PATH = path.resolve('memory/tyfys-sms-autopilot.json');
const DOC_EXPORT_URL = 'https://docs.google.com/document/d/1g2hC0qzFcAPjkawu4ArAAjlgsq1Rg8_ue7L-mN8UA6w/export?format=txt';

const BOOKING_LINE = 'Book here if easier: zbooking.us/hh8dC';

const DEFAULT_LEAD_SLA_HOURS = 48;

const LINE_NUMBERS = {
  DEVIN: '+13212147853',
  ADAM: '+14072168511',
  AMY: '+13212349530',
  JARED: '+16822675268',
  KAREN: '+17724099069',
};

function lineToUserKey(fromNumber) {
  const n = normalizePhone(fromNumber);
  if (!n) return null;
  if (n === normalizePhone(LINE_NUMBERS.DEVIN)) return 'devin';
  if (n === normalizePhone(LINE_NUMBERS.ADAM)) return 'adam';
  if (n === normalizePhone(LINE_NUMBERS.AMY)) return 'amy';
  if (n === normalizePhone(LINE_NUMBERS.JARED)) return 'jared';
  if (n === normalizePhone(LINE_NUMBERS.KAREN)) return 'karen';
  return null;
}

const QUIET_START_PT_HOUR = 21; // 9pm PT
const QUIET_END_PT_HOUR = 8; // 8am PT

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const dryRun = process.argv.includes('--dry-run');
const lookbackMin = Number(getArg('--lookbackMin', '60'));
const mode = getArg('--mode', 'schedule'); // schedule | reactive
const tenant = getArg('--tenant', 'new'); // RingCentral tenant/app namespace (default: new)

// New: proactive lead SLA outreach (owner-based) for leads untouched for N hours.
// Enabled by default in schedule mode (per Richard request), can be disabled with --no-lead-sla.
const leadSlaEnabled = !process.argv.includes('--no-lead-sla') && mode === 'schedule';
const leadSlaHours = Number(getArg('--leadSlaHours', String(DEFAULT_LEAD_SLA_HOURS)));
const leadLimit = Number(getArg('--leadLimit', '120'));

const repsArg = getArg('--reps', ''); // optional: comma-separated rep keys (adam,amy,jared,devin,karen)
const allowedRepKeys = new Set(
  String(repsArg || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
);

function normalizePhone(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  // RingCentral returns +1XXXXXXXXXX typically.
  if (s.startsWith('+')) return s;
  const digits = s.replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return s;
}

function nowPtParts() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

function inQuietHours() {
  const { hour } = nowPtParts();
  // quiet if hour >= 21 OR hour < 8
  return hour >= QUIET_START_PT_HOUR || hour < QUIET_END_PT_HOUR;
}

function inMorningWindowPt() {
  const { hour } = nowPtParts();
  // 9:00–12:00 PT
  return hour >= 9 && hour < 12;
}

function inEveningWindowPt() {
  const { hour } = nowPtParts();
  // 16:00–20:30 PT
  return hour >= 16 && hour < 20;
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
  } catch {
    return {
      lastRunAt: null,
      lastMessageStoreId: null,
      // Per counterparty phone: { firstSeenAt, lastInboundAt, lastOutboundAt, lastLine, day0At, stopped }
      contacts: {},
    };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function fetchDocText() {
  const res = await fetch(DOC_EXPORT_URL, { headers: { Accept: 'text/plain' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to fetch followup doc export (${res.status}): ${t.slice(0, 200)}`);
  }
  return await res.text();
}

function parseSmsTemplates(docText) {
  // Very lightweight parser.
  // We extract "Day N" blocks and within each, pick one "SMS – Morning" and one "SMS – Evening".
  const lines = docText.split(/\r?\n/);

  const days = new Map();
  let curDay = null;
  let curBucket = null; // 'morning' | 'evening'

  function ensureDay(n) {
    if (!days.has(n)) days.set(n, { morning: [], evening: [] });
    return days.get(n);
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    const mDay = line.match(/^Day\s+(\d+)\b/i);
    if (mDay) {
      curDay = Number(mDay[1]);
      curBucket = null;
      ensureDay(curDay);
      continue;
    }

    if (!curDay) continue;

    if (/^SMS\s*[–-]\s*Morning/i.test(line) || /^SMS\s*\u2013\s*Morning/i.test(line)) {
      curBucket = 'morning';
      continue;
    }
    if (/^SMS\s*[–-]\s*Evening/i.test(line) || /^SMS\s*\u2013\s*Evening/i.test(line)) {
      curBucket = 'evening';
      continue;
    }

    // Ignore non-SMS buckets.
    if (!curBucket) continue;

    // Skip meta notes.
    if (!line) continue;
    if (line.startsWith('(') && line.endsWith(')')) continue;

    // Collect paragraph until we hit a new bucket marker or Day.
    // Here we treat each non-empty line as a candidate message.
    // Many days have duplicate options; we'll pick the best one later.
    const d = ensureDay(curDay);
    d[curBucket].push(raw.replace(/\s+$/g, ''));
  }

  function pickBest(msgs) {
    // Prefer a line that contains a question mark or "book" to drive CTA, otherwise first.
    const cleaned = (msgs || []).map(s => s.trim()).filter(Boolean);
    if (!cleaned.length) return null;
    const withBook = cleaned.find(s => /\bbook\b/i.test(s) || /zbooking/i.test(s));
    if (withBook) return withBook;
    const withQ = cleaned.find(s => s.includes('?'));
    return withQ || cleaned[0];
  }

  const out = {};
  for (const [day, buckets] of days.entries()) {
    out[day] = {
      morning: pickBest(buckets.morning),
      evening: pickBest(buckets.evening),
    };
  }
  return out;
}

function chooseDayNumber({ day0At }) {
  const base = day0At ? new Date(day0At) : new Date();
  const now = new Date();
  const diffDays = Math.floor((now - base) / (24 * 3600 * 1000));
  return Math.max(1, diffDays + 1);
}

function shouldStopFromInbound(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return ['stop', 'unsubscribe', 'do not contact', 'wrong number', 'wrong #'].some(k => t.includes(k));
}

function isDisqualifiedLeadStatus(status) {
  const t = String(status || '').trim().toLowerCase();
  if (!t) return false;
  // Conservative: treat these as “no / stop / do not contact / dead”.
  return [
    'do not',
    'dnc',
    'junk',
    'spam',
    'dead',
    'not qualified',
    'unqualified',
    'rejected',
    'wrong',
    'duplicate',
    'not interested',
    'no',
    'stop',
  ].some((k) => t.includes(k));
}

function newestIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

async function zohoFindLeadOrDeal({ accessToken, apiDomain, phone }) {
  // Try Leads first.
  const qLead = `select id, First_Name, Last_Name, Full_Name, Email, Phone, Mobile, Owner, Lead_Status from Leads where (Phone = '${phone}' or Mobile = '${phone}') limit 1`;
  const leadRes = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: qLead }).catch(() => null);
  const lead = leadRes?.data?.[0];
  if (lead) return { kind: 'lead', record: lead };

  // Try Contacts (for deals/clients). We keep it minimal and return contact + owner if possible.
  const qContact = `select id, Full_Name, Email, Phone, Mobile, Owner from Contacts where (Phone = '${phone}' or Mobile = '${phone}') limit 1`;
  const contactRes = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: qContact }).catch(() => null);
  const contact = contactRes?.data?.[0];
  if (contact) return { kind: 'contact', record: contact };

  return null;
}

async function zohoFetchActiveUsersById({ accessToken, apiDomain }) {
  const j = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery: '/crm/v2/users?type=ActiveUsers' });
  const users = j?.users || [];
  const m = new Map();
  for (const u of users) {
    m.set(String(u.id), String(u.full_name || ''));
  }
  return m;
}

async function zohoFetchLeadSlaCandidates({ accessToken, apiDomain, slaHours, limit }) {
  const cutoff = new Date(Date.now() - slaHours * 3600 * 1000);
  const cutoffIso = cutoff.toISOString().replace(/\.\d{3}Z$/, '+00:00');

  // Leads module does NOT support Modified_Time in this org; use Last_Activity_Time + Created_Time.
  // We pull a capped set and filter locally.
  const q = `select id, Full_Name, Owner, Phone, Mobile, Lead_Status, Created_Time, Last_Activity_Time from Leads where Created_Time <= '${cutoffIso}' limit ${Math.min(Math.max(Number(limit) || 120, 1), 200)}`;
  const res = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: q });
  const rows = res?.data || [];

  const userNameById = await zohoFetchActiveUsersById({ accessToken, apiDomain }).catch(() => new Map());

  const out = [];
  for (const l of rows) {
    if (isDisqualifiedLeadStatus(l?.Lead_Status)) continue;

    const phone = normalizePhone(l?.Mobile || l?.Phone);
    if (!phone) continue;

    const lastTouch = l?.Last_Activity_Time || l?.Created_Time;
    if (!lastTouch) continue;

    const lastTouchMs = new Date(lastTouch).getTime();
    if (!Number.isFinite(lastTouchMs) || lastTouchMs > cutoff.getTime()) continue;

    const ownerId = String(l?.Owner?.id || '');
    const ownerName = String(l?.Owner?.name || userNameById.get(ownerId) || '').trim() || null;

    out.push({
      id: String(l.id),
      name: String(l.Full_Name || '').trim(),
      ownerName,
      phone,
      lastTouch,
      leadStatus: l?.Lead_Status || null,
    });
  }

  // oldest first (stale first)
  out.sort((a, b) => new Date(a.lastTouch).getTime() - new Date(b.lastTouch).getTime());
  return out;
}

function ownerToLine(ownerName) {
  const n = String(ownerName || '').toLowerCase();
  if (n.includes('adam')) return LINE_NUMBERS.ADAM;
  if (n.includes('amy')) return LINE_NUMBERS.AMY;
  if (n.includes('jared')) return LINE_NUMBERS.JARED;
  if (n.includes('devin')) return LINE_NUMBERS.DEVIN;
  if (n.includes('karen')) return LINE_NUMBERS.KAREN;
  // Default to Richard's main line? We don't have it here; leave null.
  return null;
}

function fromNumberAllowed(fromNumber) {
  if (!allowedRepKeys.size) return true;
  const keyByNumber = Object.entries(LINE_NUMBERS).find(([, num]) => num === fromNumber)?.[0]?.toLowerCase();
  return keyByNumber ? allowedRepKeys.has(keyByNumber) : false;
}

async function fetchRecentSms({ fromDate }) {
  // message-store includes inbound/outbound; filter type=SMS.
  const qs = new URLSearchParams({
    dateFrom: fromDate.toISOString(),
    perPage: '200',
    messageType: 'SMS',
  });
  return ringcentralGetJson(`/restapi/v1.0/account/~/extension/~/message-store?${qs.toString()}`, { tenant });
}

function getRecordCounterparty(rec) {
  const from = normalizePhone(rec?.from?.phoneNumber);
  const to = normalizePhone(rec?.to?.[0]?.phoneNumber);
  return { from, to };
}

async function main() {
  const state = await readState();
  const docText = await fetchDocText();
  const templates = parseSmsTemplates(docText);

  const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
  const zohoToken = await getZohoAccessToken();

  const fromDate = new Date(Date.now() - lookbackMin * 60 * 1000);
  const store = await fetchRecentSms({ fromDate });
  const records = Array.isArray(store?.records) ? store.records : [];

  // Determine last-spoke-to line per counterparty from history in window.
  for (const rec of records) {
    const dir = String(rec?.direction || '').toLowerCase();
    const { from, to } = getRecordCounterparty(rec);
    if (!from || !to) continue;

    // Heuristic: if inbound, counterparty=from; line=to. if outbound, counterparty=to; line=from.
    const isInbound = dir === 'inbound';
    const counterparty = isInbound ? from : to;
    const line = isInbound ? to : from;

    const c = (state.contacts[counterparty] ||= {
      firstSeenAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      lastLine: null,
      day0At: null,
      stopped: false,
      sent: {}, // { [day]: { morningAt, eveningAt } }
    });
    if (!c.firstSeenAt) c.firstSeenAt = rec.creationTime || new Date().toISOString();
    if (isInbound) c.lastInboundAt = rec.creationTime || new Date().toISOString();
    if (!isInbound) c.lastOutboundAt = rec.creationTime || new Date().toISOString();
    c.lastLine = line;

    // If inbound says stop, mark stopped.
    if (isInbound && shouldStopFromInbound(rec?.subject)) {
      c.stopped = true;
    }

    // day0At: first inbound we ever saw (approx)
    if (!c.day0At && isInbound) c.day0At = rec.creationTime || new Date().toISOString();
  }

  if (inQuietHours()) {
    state.lastRunAt = new Date().toISOString();
    await writeState(state);
    process.stdout.write('Quiet hours active (PT). No sends.\n');
    return;
  }

  // Proactive SLA-based outreach for stale leads (schedule mode only)
  if (leadSlaEnabled) {
    const candidates = await zohoFetchLeadSlaCandidates({
      accessToken: zohoToken,
      apiDomain,
      slaHours: leadSlaHours,
      limit: leadLimit,
    }).catch(() => []);

    for (const l of candidates) {
      // Respect stop flags if we have them.
      const c = (state.contacts[l.phone] ||= {
        firstSeenAt: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        lastLine: null,
        day0At: null,
        stopped: false,
        sent: {},
      });
      if (c.stopped) continue;

      // Only send if we haven't touched them in the last 48h (either direction) according to our local history.
      // If we have no local history, rely on Zoho lastTouch filter.
      const lastLocalTouch = newestIso(c.lastInboundAt, c.lastOutboundAt);
      if (lastLocalTouch) {
        const ms = new Date(lastLocalTouch).getTime();
        if (Date.now() - ms < leadSlaHours * 3600 * 1000) continue;
      }

      const fromNumber = ownerToLine(l.ownerName);
      if (!fromNumber) continue;
      if (!fromNumberAllowed(fromNumber)) continue;

      // In schedule mode, only send during the windows; prefer morning template in AM window and evening template in PM window.
      const wantMorning = inMorningWindowPt();
      const wantEvening = inEveningWindowPt();
      if (!wantMorning && !wantEvening) continue;

      const day = chooseDayNumber({ day0At: c.day0At });
      const sentDay = (c.sent ||= {});
      const sentMeta = (sentDay[day] ||= { morningAt: null, eveningAt: null });

      // If we already sent a morning/evening text today, don't send another.
      const shouldSendMorning = wantMorning && !sentMeta.morningAt;
      const shouldSendEvening = !shouldSendMorning && wantEvening && !sentMeta.eveningAt;
      if (!shouldSendMorning && !shouldSendEvening) continue;

      const msg = shouldSendEvening
        ? (templates?.[day]?.evening || templates?.[1]?.evening)
        : (templates?.[day]?.morning || templates?.[1]?.morning);
      if (!msg) continue;

      const text = `${msg}\n\n${BOOKING_LINE}`;

      if (dryRun) {
        process.stdout.write(`[dry-run] SLA${leadSlaHours}h LEAD(${l.ownerName || 'n/a'}) to ${l.phone} from ${fromNumber}: ${text}\n`);
      } else {
        await ringcentralSendSms({ fromNumber, toNumber: l.phone, text, tenant, userKey: lineToUserKey(fromNumber) });
      }

      const nowIso2 = new Date().toISOString();
      if (shouldSendMorning) sentMeta.morningAt = nowIso2;
      if (shouldSendEvening) sentMeta.eveningAt = nowIso2;
      c.lastOutboundAt = nowIso2;
      // continue scanning; cap volume naturally by leadLimit + window
    }
  }

  const nowIso = new Date().toISOString();
  const sendMorning = mode === 'reactive' ? true : inMorningWindowPt();
  const sendEvening = mode === 'schedule' ? inEveningWindowPt() : false;

  for (const [phone, c] of Object.entries(state.contacts)) {
    if (c.stopped) continue;

    // In reactive mode, only respond to recent inbound.
    if (mode === 'reactive') {
      if (!c.lastInboundAt) continue;
      const lastInboundMs = new Date(c.lastInboundAt).getTime();
      if (Date.now() - lastInboundMs > lookbackMin * 60 * 1000) continue;
    }

    const day = chooseDayNumber({ day0At: c.day0At });
    const sentDay = (c.sent ||= {});
    const sentMeta = (sentDay[day] ||= { morningAt: null, eveningAt: null });

    // In schedule mode: send at most one morning + one evening per day.
    const wantMorning = sendMorning && !sentMeta.morningAt;
    const wantEvening = sendEvening && !sentMeta.eveningAt;

    if (!wantMorning && !wantEvening) continue;

    // Find Zoho record.
    const match = await zohoFindLeadOrDeal({ accessToken: zohoToken, apiDomain, phone });

    let kind = match?.kind || 'unknown';
    let ownerName = match?.record?.Owner?.name;

    // Determine fromNumber.
    let fromNumber = null;
    if (kind === 'lead' || kind === 'unknown') {
      fromNumber = ownerToLine(ownerName);
      // If rep filtering is enabled and we can't map owner->line, skip (avoid sending from wrong rep).
      if (allowedRepKeys.size && !fromNumber) continue;
      fromNumber = fromNumber || LINE_NUMBERS.AMY;
    } else {
      fromNumber = c.lastLine || LINE_NUMBERS.DEVIN;
    }

    // If rep filtering is enabled, only send when the chosen fromNumber is one of the allowed rep lines.
    if (!fromNumberAllowed(fromNumber)) continue;

    const msg = wantEvening ? (templates?.[day]?.evening || templates?.[1]?.evening) : (templates?.[day]?.morning || templates?.[1]?.morning);
    if (!msg) continue;

    const text = `${msg}\n\n${BOOKING_LINE}`;

    if (dryRun) {
      process.stdout.write(`[dry-run] ${wantEvening ? 'EVENING' : 'MORNING'} ${kind.toUpperCase()}(${ownerName || 'n/a'}) to ${phone} from ${fromNumber}: ${text}\n`);
    } else {
      await ringcentralSendSms({ fromNumber, toNumber: phone, text, tenant, userKey: lineToUserKey(fromNumber) });
    }

    if (wantEvening) sentMeta.eveningAt = nowIso;
    if (wantMorning) sentMeta.morningAt = nowIso;

    c.lastOutboundAt = nowIso;
  }

  state.lastRunAt = new Date().toISOString();
  await writeState(state);
  process.stdout.write(`Done. dryRun=${dryRun}\n`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
