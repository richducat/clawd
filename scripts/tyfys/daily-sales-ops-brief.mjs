#!/usr/bin/env node
/**
 * TYFYS Daily Sales + Ops Brief (WhatsApp-friendly text)
 *
 * Focus: Sales calls/SMS activity + Zoho deal movement + meetings booked.
 *
 * Usage:
 *   node scripts/tyfys/daily-sales-ops-brief.mjs --hours 24 --connectedSec 30 --fewMin 2
 */

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql } from '../lib/zoho.mjs';
import { ringcentralGetJson } from '../lib/ringcentral.mjs';

loadEnvLocal();

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const hours = Number(getArg('--hours', '24'));
const connectedSec = Number(getArg('--connectedSec', '30'));
const fewMin = Number(getArg('--fewMin', '2'));
const fewMinSec = Math.round(fewMin * 60);

const now = new Date();
const from = new Date(now.getTime() - hours * 60 * 60 * 1000);

const RC_API_SERVER = process.env.RINGCENTRAL_API_SERVER || 'https://platform.ringcentral.com';
const RC_CLIENT_ID = process.env.RINGCENTRAL_CLIENT_ID;
const RC_CLIENT_SECRET = process.env.RINGCENTRAL_CLIENT_SECRET;
const RC_REFRESH_TOKEN = process.env.RINGCENTRAL_REFRESH_TOKEN;

const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

function iso(d) {
  // Zoho COQL datetime literals reject milliseconds.
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function fmtLocal(dt) {
  try {
    return new Date(dt).toLocaleString('en-US');
  } catch {
    return String(dt);
  }
}

function formatDuration(sec) {
  const s = Math.round(sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function basicAuthHeader(id, secret) {
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

// RingCentral token refresh + rotation handled by scripts/lib/ringcentral.mjs

function summarizeCalls(records) {
  const out = {
    total: 0,
    inbound: 0,
    outbound: 0,
    missed: 0,
    connected: 0,
    fewMin: 0,
    totalDurationSec: 0,
  };

  for (const r of records || []) {
    out.total += 1;
    if (r.direction === 'Inbound') out.inbound += 1;
    if (r.direction === 'Outbound') out.outbound += 1;
    if (r.result === 'Missed') out.missed += 1;

    const dur = Number(r.duration) || 0;
    out.totalDurationSec += dur;

    if (dur >= connectedSec) out.connected += 1;
    if (dur >= fewMinSec) out.fewMin += 1;
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

function topBy(arr, keyFn, limit = 5) {
  const m = new Map();
  for (const item of arr || []) {
    const k = keyFn(item);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

async function zohoFetchDealMovement({ accessToken }) {
  // Deals modified in the last window (includes stage changes + any edits)
  // NOTE: field API names can vary; we’ll request common ones.
  const q = `select id, Deal_Name, Stage, Amount, Closing_Date, Owner, Modified_By, Modified_Time, Created_Time from Deals where Modified_Time >= '${iso(from)}' and Modified_Time <= '${iso(now)}' order by Modified_Time desc limit 200`;
  const res = await zohoCrmCoql({ accessToken, apiDomain: ZOHO_API_DOMAIN, selectQuery: q });
  const deals = res?.data || [];

  const createdToday = deals.filter(d => d.Created_Time && new Date(d.Created_Time) >= from);
  const closedWon = deals.filter(d => String(d.Stage || '').toLowerCase().includes('closed won'));
  const closedLost = deals.filter(d => String(d.Stage || '').toLowerCase().includes('closed lost'));

  return { deals, createdToday, closedWon, closedLost };
}

async function zohoFetchMeetingsBooked({ accessToken }) {
  // Events created during the window, and occurring in the future.
  // This approximates “meetings booked today” (created_time window), regardless of meeting date.
  const q = `select id, Event_Title, Start_DateTime, End_DateTime, Owner, Created_Time, Modified_By, What_Id from Events where Created_Time >= '${iso(from)}' and Created_Time <= '${iso(now)}' order by Created_Time desc limit 200`;
  const res = await zohoCrmCoql({ accessToken, apiDomain: ZOHO_API_DOMAIN, selectQuery: q });
  const events = (res?.data || []).filter(e => e.Start_DateTime && new Date(e.Start_DateTime) >= now);
  return { events };
}

function briefHeader() {
  return `Daily Sales + Ops Brief — ${now.toLocaleDateString('en-US')}`;
}

(async function main() {
  const lines = [];
  lines.push(briefHeader());
  lines.push(`Window: last ${hours}h | connected≥${connectedSec}s | long≥${fewMin}m`);

  // RingCentral activity
  const callLog = await ringcentralGetJson(`/restapi/v1.0/account/~/extension/~/call-log?dateFrom=${encodeURIComponent(iso(from))}&dateTo=${encodeURIComponent(iso(now))}&perPage=1000`);
  const msgs = await ringcentralGetJson(`/restapi/v1.0/account/~/extension/~/message-store?dateFrom=${encodeURIComponent(iso(from))}&dateTo=${encodeURIComponent(iso(now))}&perPage=1000`);

  const callSummary = summarizeCalls(callLog.records);
  const msgSummary = summarizeMessages(msgs.records);

  lines.push('');
  lines.push('SALES ACTIVITY (RingCentral)');
  lines.push(`Calls: ${callSummary.total} (in ${callSummary.inbound} / out ${callSummary.outbound} / missed ${callSummary.missed})`);
  lines.push(`Connected calls (≥${connectedSec}s): ${callSummary.connected}`);
  lines.push(`Long calls (≥${fewMin}m): ${callSummary.fewMin}`);
  lines.push(`Talk time: ${formatDuration(callSummary.totalDurationSec)}`);
  lines.push(`Messages: ${msgSummary.total} (SMS ${msgSummary.sms} / VM ${msgSummary.voicemail})`);

  const missedInbound = (callLog.records || [])
    .filter(r => r.direction === 'Inbound' && r.result === 'Missed')
    .slice(0, 10)
    .map(r => ({
      when: r.startTime,
      from: r.from?.phoneNumber || r.from?.name || 'Unknown',
      to: r.to?.phoneNumber || r.to?.name || 'Unknown',
    }));

  if (missedInbound.length) {
    lines.push('');
    lines.push('Missed inbound (latest):');
    for (const m of missedInbound) {
      lines.push(`- ${fmtLocal(m.when)}: ${m.from} → ${m.to}`);
    }
  }

  const inboundSms = (msgs.records || []).filter(r => r.type === 'SMS' && r.direction === 'Inbound');
  const topInboundSms = topBy(inboundSms, r => r.from?.phoneNumber || r.from?.name, 8);
  if (topInboundSms.length) {
    lines.push('');
    lines.push('Who texted you (inbound SMS top):');
    for (const [num, count] of topInboundSms) {
      lines.push(`- ${num}: ${count}`);
    }
  }

  // Zoho CRM
  const zohoToken = await getZohoAccessToken();
  const { deals, createdToday, closedWon, closedLost } = await zohoFetchDealMovement({ accessToken: zohoToken });
  const { events } = await zohoFetchMeetingsBooked({ accessToken: zohoToken });

  lines.push('');
  lines.push('PIPELINE MOVEMENT (Zoho CRM)');
  lines.push(`Deals updated: ${deals.length}`);
  lines.push(`Deals created: ${createdToday.length}`);
  lines.push(`Closed won: ${closedWon.length}`);
  lines.push(`Closed lost: ${closedLost.length}`);

  // Latest deal updates list (short)
  const latestDeals = deals.slice(0, 12).map(d => {
    const name = d.Deal_Name || d.id;
    const stage = d.Stage || '—';
    const owner = d.Owner?.name || '—';
    const by = d.Modified_By?.name || '—';
    const when = d.Modified_Time ? fmtLocal(d.Modified_Time) : '—';
    return `- ${when}: ${name} | ${stage} | owner ${owner} | by ${by}`;
  });

  if (latestDeals.length) {
    lines.push('');
    lines.push('Latest deal updates (top 12):');
    lines.push(...latestDeals);
  }

  lines.push('');
  lines.push('MEETINGS BOOKED (Zoho Events created in window)');
  lines.push(`New meetings booked: ${events.length}`);

  const nextMeetings = events
    .sort((a, b) => new Date(a.Start_DateTime) - new Date(b.Start_DateTime))
    .slice(0, 12)
    .map(e => {
      const when = e.Start_DateTime ? fmtLocal(e.Start_DateTime) : '—';
      const subj = e.Event_Title || 'Meeting';
      const owner = e.Owner?.name || '—';
      return `- ${when}: ${subj} (owner ${owner})`;
    });

  if (nextMeetings.length) {
    lines.push('');
    lines.push('Upcoming newly-booked meetings (top 12):');
    lines.push(...nextMeetings);
  }

  process.stdout.write(lines.join('\n') + '\n');
})().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
