#!/usr/bin/env node
/**
 * TYFYS Sales KPI Scoreboard (RingCentral Team Messaging)
 *
 * Posts a rep-facing KPI snapshot into the RingCentral Sales Team chat to drive accountability.
 *
 * Metrics (per rep):
 * - Outbound calls + outbound SMS (previous business day by default)
 * - Connected calls (>=30s) + contact rate
 * - Meetings booked today (Zoho Bookings preferred; falls back to Zoho CRM Events)
 * - Meetings on calendar today (Zoho Bookings preferred; falls back to Zoho CRM Events)
 * - Deals created (previous business day / WTD / MTD)
 * - Lead bucket health (Zoho Leads): total, attempted (touched), never touched
 *
 * Options:
 *   --window previousBusinessDay|today   (default: previousBusinessDay)
 *
 * Notes:
 * - Even in previousBusinessDay mode, meetings shown are for TODAY (prep load).
 *
 * Usage:
 *   node scripts/tyfys/sales-kpi-scoreboard-ringcentral-update.mjs --chatId 156659499014 --tenant new
 */

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import {
  getZohoAccessToken,
  zohoCrmCoql,
  zohoCrmGet,
  zohoBookingsReportGet,
} from '../lib/zoho.mjs';
import { ringcentralGetJson, ringcentralPostJson } from '../lib/ringcentral.mjs';

loadEnvLocal();

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const SALES_ROSTER = ['Adam', 'Amy', 'Jared', 'Ashley'];
const CALL_QUOTA = 25;
const CONNECTED_SEC = 30;

const tenant = getArg('--tenant', 'new');
const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

const ZB_OWNER_NAME = process.env.ZOHO_BOOKINGS_OWNER_NAME || 'clay_thankyouforyourservice';
const ZB_WORKSPACE_ID = process.env.ZOHO_BOOKINGS_WORKSPACE_ID || '4739587000000043008';

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfLocalWeek(d) {
  // Monday start (ET local)
  const x = startOfLocalDay(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const delta = (day + 6) % 7; // Mon=0
  x.setDate(x.getDate() - delta);
  return x;
}

function startOfLocalMonth(d) {
  const x = startOfLocalDay(d);
  x.setDate(1);
  return x;
}

function isoNoMs(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function fmtTimeET(d) {
  try {
    return new Date(d).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return String(d);
  }
}

function hoursSince(dt, now) {
  if (!dt) return Infinity;
  return (now.getTime() - dt.getTime()) / 36e5;
}

function bucketLabel(h) {
  if (h < 24) return '<24h';
  if (h < 48) return '24–48h';
  if (h < 168) return '2–7d';
  return '>7d';
}

function normRep(nameLike) {
  const n = String(nameLike || '').toLowerCase();
  return SALES_ROSTER.find(r => n.includes(r.toLowerCase())) || null;
}

async function postToRingCentralChat({ chatId, text }) {
  return ringcentralPostJson(`/restapi/v1.0/glip/chats/${chatId}/posts`, { text }, { tenant });
}

async function getRcExtensionsForRoster() {
  const extRes = await ringcentralGetJson('/restapi/v1.0/account/~/extension?perPage=200', { tenant });
  const exts = extRes?.records || [];

  const roster = new Map();
  for (const rep of SALES_ROSTER) {
    const match = exts.find(e => {
      const n = `${e?.contact?.firstName || ''} ${e?.contact?.lastName || ''}`.trim();
      const uname = String(e?.name || '');
      return n.toLowerCase().includes(rep.toLowerCase()) || uname.toLowerCase().includes(rep.toLowerCase());
    });
    if (match?.id) roster.set(rep, match.id);
  }

  return roster;
}

async function getRcDailyActivity({ from, to }) {
  const rosterIds = await getRcExtensionsForRoster();
  const out = new Map();

  for (const rep of SALES_ROSTER) {
    const extId = rosterIds.get(rep);
    if (!extId) {
      out.set(rep, {
        callsOut: 0,
        smsOut: 0,
        connected: 0,
        contactRate: 0,
      });
      continue;
    }

    const callLog = await ringcentralGetJson(
      `/restapi/v1.0/account/~/extension/${extId}/call-log?dateFrom=${encodeURIComponent(isoNoMs(from))}&dateTo=${encodeURIComponent(isoNoMs(to))}&perPage=1000`,
      { tenant },
    );
    const msgStore = await ringcentralGetJson(
      `/restapi/v1.0/account/~/extension/${extId}/message-store?dateFrom=${encodeURIComponent(isoNoMs(from))}&dateTo=${encodeURIComponent(isoNoMs(to))}&perPage=1000`,
      { tenant },
    );

    const callsOutRecs = (callLog?.records || []).filter(r => r.direction === 'Outbound');
    const callsOut = callsOutRecs.length;
    const connected = callsOutRecs.filter(r => (Number(r.duration) || 0) >= CONNECTED_SEC).length;

    const smsOut = (msgStore?.records || []).filter(r => r.type === 'SMS' && r.direction === 'Outbound').length;

    const contactRate = callsOut ? connected / callsOut : 0;

    out.set(rep, { callsOut, smsOut, connected, contactRate });
  }

  return out;
}

function fmtBookingsCriteriaDate(d) {
  // Bookings Creator criteria uses: "02-Feb-2026 20:51:00"
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = months[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${dd}-${mon}-${yyyy} ${hh}:${mm}:${ss}`;
}

async function fetchMeetings({ accessToken, todayStart, tomorrowStart, now }) {
  // Prefer Bookings if scope exists; otherwise fall back to CRM Events.
  let meetingsToday = [];
  let bookedToday = [];
  let used = 'bookings';

  try {
    // Meetings happening today
    const criteriaToday = `WORKSPACE_ID==${ZB_WORKSPACE_ID} && FROM_TIME>\"${fmtBookingsCriteriaDate(todayStart)}\" && FROM_TIME<\"${fmtBookingsCriteriaDate(tomorrowStart)}\"`;
    const outToday = await zohoBookingsReportGet({
      accessToken,
      ownerName: ZB_OWNER_NAME,
      reportLinkName: 'WEB_APPOINTMENT',
      query: { max_records: 200, sortBy: 'FROM_TIME:true', criteria: criteriaToday },
    });
    meetingsToday = (outToday?.data || outToday || []).map(r => ({
      title: r.SERVICE_NAME || r.APPOINTMENT_FOR || r.Service_Name || 'Booking',
      from: r.FROM_TIME || r.From_Time,
      owner: r.ASSIGNED_TO || r.Assigned_To || r.STAFF_NAME || r.Staff_Name,
      created: r.Created_Time || r.CREATEDTIME || r.CreatedTime || r.CREATED_TIME || null,
    }));

    // Meetings booked today (created today) — best effort if created field exists; otherwise will remain empty.
    const criteriaCreated = `WORKSPACE_ID==${ZB_WORKSPACE_ID} && CREATEDTIME>\"${fmtBookingsCriteriaDate(todayStart)}\" && CREATEDTIME<\"${fmtBookingsCriteriaDate(tomorrowStart)}\"`;
    const outCreated = await zohoBookingsReportGet({
      accessToken,
      ownerName: ZB_OWNER_NAME,
      reportLinkName: 'WEB_APPOINTMENT',
      query: { max_records: 200, sortBy: 'CREATEDTIME:true', criteria: criteriaCreated },
    }).catch(() => null);

    if (outCreated) {
      bookedToday = (outCreated?.data || outCreated || []).map(r => ({
        title: r.SERVICE_NAME || r.APPOINTMENT_FOR || r.Service_Name || 'Booking',
        from: r.FROM_TIME || r.From_Time,
        owner: r.ASSIGNED_TO || r.Assigned_To || r.STAFF_NAME || r.Staff_Name,
      }));
    }

    return { meetingsToday, bookedToday, used };
  } catch (e) {
    used = 'crm-events';
  }

  // Fallback: Zoho CRM Events
  const qToday = `select id, Event_Title, Start_DateTime, Owner, Created_Time from Events where Start_DateTime >= '${isoNoMs(todayStart)}' and Start_DateTime < '${isoNoMs(tomorrowStart)}' order by Start_DateTime asc limit 200`;
  const resToday = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: qToday });
  meetingsToday = (resToday?.data || []).map(e => ({
    title: e.Event_Title || 'Meeting',
    from: e.Start_DateTime,
    owner: e?.Owner?.name,
    created: e.Created_Time,
  }));

  const qBooked = `select id, Event_Title, Start_DateTime, Owner, Created_Time from Events where Created_Time >= '${isoNoMs(todayStart)}' and Created_Time < '${isoNoMs(tomorrowStart)}' order by Created_Time desc limit 200`;
  const resBooked = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: qBooked });
  bookedToday = (resBooked?.data || []).map(e => ({
    title: e.Event_Title || 'Meeting',
    from: e.Start_DateTime,
    owner: e?.Owner?.name,
  }));

  return { meetingsToday, bookedToday, used };
}

async function fetchDealsCreatedCounts({ accessToken, start, end }) {
  const q = `select id, Owner, Created_Time from Deals where Created_Time >= '${isoNoMs(start)}' and Created_Time < '${isoNoMs(end)}' limit 200`;
  const res = await zohoCrmCoql({ accessToken, apiDomain, selectQuery: q });
  const deals = res?.data || [];

  const byRep = new Map();
  for (const rep of SALES_ROSTER) byRep.set(rep, 0);

  for (const d of deals) {
    const rep = normRep(d?.Owner?.name);
    if (!rep) continue;
    byRep.set(rep, (byRep.get(rep) || 0) + 1);
  }

  return byRep;
}

async function fetchLeadTouchCounts({ accessToken, days = 365, pages = 10, perPage = 200 }) {
  // Reuse the same Lead list/criteria trick used in the buckets script.
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const sinceYmd = since.toISOString().slice(0, 10);
  const criteria = `(Modified_Time:after:${sinceYmd})`;

  const fields = [
    'id',
    'Owner',
    'Lead_Status',
    'Created_Time',
    'Last_Activity_Time',
    'Modified_Time',
  ].join(',');

  let leads = [];
  for (let page = 1; page <= pages; page++) {
    const pathAndQuery = `/crm/v2/Leads?fields=${encodeURIComponent(fields)}&page=${page}&per_page=${perPage}&criteria=${encodeURIComponent(criteria)}`;
    const res = await zohoCrmGet({ accessToken, apiDomain, pathAndQuery });
    const rows = res?.data || [];
    leads.push(...rows);
    if (!res?.info?.more_records || rows.length === 0) break;
  }

  function isActiveLeadStatus(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('junk')) return false;
    if (s.includes('dead')) return false;
    if (s.includes('do not call')) return false;
    if (s.includes('opt')) return false;
    return true;
  }

  leads = leads.filter(l => normRep(l?.Owner?.name) && isActiveLeadStatus(l?.Lead_Status));

  const out = new Map();
  for (const rep of SALES_ROSTER) {
    out.set(rep, {
      total: 0,
      attempted: 0, // Last_Activity_Time present
      neverTouched: 0,
      buckets: { '<24h': 0, '24–48h': 0, '2–7d': 0, '>7d': 0 },
    });
  }

  const now = new Date();
  for (const l of leads) {
    const rep = normRep(l?.Owner?.name);
    if (!rep) continue;

    const s = out.get(rep);
    s.total += 1;

    const lastAct = l?.Last_Activity_Time ? new Date(l.Last_Activity_Time) : null;
    const created = l?.Created_Time ? new Date(l.Created_Time) : null;

    // Some Zoho setups populate Last_Activity_Time on create; treat that as “untouched”.
    const touched = (() => {
      if (!lastAct) return false;
      if (!created) return true;
      return Math.abs(lastAct.getTime() - created.getTime()) > 5 * 60 * 1000; // >5m after create
    })();

    if (touched) s.attempted += 1;
    else s.neverTouched += 1;

    const lastTouch = lastAct || created;
    const b = bucketLabel(hoursSince(lastTouch, now));
    s.buckets[b] += 1;
  }

  return out;
}

(async function main() {
  const chatId = getArg('--chatId', null);
  if (!chatId) {
    console.error('Missing --chatId');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');

  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 3600 * 1000);
  const weekStart = startOfLocalWeek(now);
  const monthStart = startOfLocalMonth(now);

  // Use previous business day by default (Mon–Fri) so the morning scoreboard reflects yesterday’s performance.
  const windowMode = getArg('--window', 'previousBusinessDay');
  if (!['previousBusinessDay', 'today'].includes(windowMode)) {
    console.error("Invalid --window. Use 'previousBusinessDay' or 'today'.");
    process.exit(1);
  }

  const previousBusinessDayStart = (() => {
    const d = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const perfFrom = windowMode === 'today' ? todayStart : previousBusinessDayStart;
  const perfTo = windowMode === 'today' ? now : todayStart;

  const accessToken = await getZohoAccessToken();

  const [rc, meetings, dealsPerfDay, dealsWtd, dealsMtd, leadTouch] = await Promise.all([
    getRcDailyActivity({ from: perfFrom, to: perfTo }),
    fetchMeetings({ accessToken, todayStart, tomorrowStart, now }),
    fetchDealsCreatedCounts({ accessToken, start: perfFrom, end: perfTo }),
    fetchDealsCreatedCounts({ accessToken, start: weekStart, end: now }),
    fetchDealsCreatedCounts({ accessToken, start: monthStart, end: now }),
    fetchLeadTouchCounts({ accessToken, days: 365, pages: 10, perPage: 200 }),
  ]);

  // Per-rep meeting counts
  const meetingsOnCalendarToday = new Map();
  const meetingsBookedToday = new Map();
  for (const rep of SALES_ROSTER) {
    meetingsOnCalendarToday.set(rep, 0);
    meetingsBookedToday.set(rep, 0);
  }

  for (const m of meetings.meetingsToday || []) {
    const rep = normRep(m?.owner) || normRep(m?.title);
    if (!rep) continue;
    meetingsOnCalendarToday.set(rep, meetingsOnCalendarToday.get(rep) + 1);
  }

  for (const m of meetings.bookedToday || []) {
    const rep = normRep(m?.owner) || normRep(m?.title);
    if (!rep) continue;
    meetingsBookedToday.set(rep, meetingsBookedToday.get(rep) + 1);
  }

  const perfLabel = windowMode === 'today'
    ? `today (through ${fmtTimeET(now)} ET)`
    : 'previous business day';

  const header = `Sales KPI scoreboard — ${todayStart.toLocaleDateString('en-US')} (as of ${fmtTimeET(now)} ET)`;
  const sub = `Performance window: ${perfLabel} | Connected >=${CONNECTED_SEC}s | Call quota ${CALL_QUOTA}/day | Meetings source: ${meetings.used}`;

  const lines = [header, sub, ''];

  for (const rep of SALES_ROSTER) {
    const a = rc.get(rep) || { callsOut: 0, smsOut: 0, connected: 0, contactRate: 0 };
    const dPerf = dealsPerfDay.get(rep) || 0;
    const dWtd = dealsWtd.get(rep) || 0;
    const dMtd = dealsMtd.get(rep) || 0;

    const mtToday = meetingsOnCalendarToday.get(rep) || 0;
    const mbToday = meetingsBookedToday.get(rep) || 0;

    const lt = leadTouch.get(rep) || { total: 0, attempted: 0, neverTouched: 0, buckets: { '<24h': 0, '24–48h': 0, '2–7d': 0, '>7d': 0 } };

    const attemptRate = lt.total ? (lt.attempted / lt.total) : 0;
    const bookingRate = a.callsOut ? (mbToday / a.callsOut) : null;

    const quotaHit = a.callsOut >= CALL_QUOTA ? '✅' : '❌';
    const busy = mtToday > 3 ? '⚠️ busy (3+ mtgs)' : '';

    const contactRateText = a.callsOut ? `${Math.round(a.contactRate * 100)}%` : 'n/a';
    const bookingRateText = bookingRate == null ? 'n/a' : `${Math.round(bookingRate * 100)}%`;

    lines.push(
      `*${rep}* ${quotaHit} calls ${a.callsOut}/${CALL_QUOTA} | conn ${a.connected} (${contactRateText}) | sms ${a.smsOut}`,
    );
    lines.push(
      `meetings: booked ${mbToday} (rate ${bookingRateText}) | today on calendar ${mtToday} ${busy}`.trim(),
    );
    lines.push(
      `deals created (${windowMode === 'today' ? 'today' : 'prev biz day'}): ${dPerf} | WTD ${dWtd} | MTD ${dMtd}`,
    );
    lines.push(
      `lead bucket: total ${lt.total} | attempted ${lt.attempted} (${Math.round(attemptRate * 100)}%) | never touched ${lt.neverTouched}`,
    );
    lines.push(
      `aging: <24h ${lt.buckets['<24h']} | 24–48h ${lt.buckets['24–48h']} | 2–7d ${lt.buckets['2–7d']} | >7d ${lt.buckets['>7d']}`,
    );
    lines.push('');
  }

  lines.push('Focus: clear >7d first, then 24–48h. Keep Zoho notes + next steps current.');

  const text = lines.join('\n').trim();

  if (dryRun) {
    process.stdout.write(`[dry-run] Would post to chatId=${chatId}:\n\n${text}\n`);
    return;
  }

  await postToRingCentralChat({ chatId, text });
  process.stdout.write('Posted KPI scoreboard to RingCentral chat.\n');
})().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
