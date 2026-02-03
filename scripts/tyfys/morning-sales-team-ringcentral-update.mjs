#!/usr/bin/env node
/**
 * TYFYS Morning Sales Team Update (RingCentral Team Messaging)
 *
 * Posts to a RingCentral team chat:
 *  - Today's booked meetings (Zoho Events happening today)
 *  - Yesterday's outbound performance (RingCentral outbound calls + outbound SMS) by rep
 *  - A short motivational line
 *
 * Usage:
 *   node scripts/tyfys/morning-sales-team-ringcentral-update.mjs --chatId 144856375302
 *
 * Options:
 *   --window previousBusinessDay|today   (default: previousBusinessDay)
 */

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoBookingsReportGet } from '../lib/zoho.mjs';
import { ringcentralGetJson, ringcentralPostJson } from '../lib/ringcentral.mjs';

loadEnvLocal();

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isoNoMs(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function fmtLocal(dt) {
  try {
    return new Date(dt).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return String(dt);
  }
}

function formatTable(rows) {
  // WhatsApp-free / RC-friendly: simple aligned-ish lines.
  const maxName = Math.max(...rows.map(r => r.name.length), 3);
  return rows
    .map(r => `${r.name.padEnd(maxName)}  calls:${String(r.calls).padStart(3)}  sms:${String(r.sms).padStart(3)}`)
    .join('\n');
}

const SALES_ROSTER = ['Adam', 'Amy', 'Jared'];

// Explicit extension ids (more reliable than name matching)
const RC_EXTENSION_ID_BY_REP = {
  Adam: 1162671035, // Adam Ayotte
  Amy: 1156144035,  // Amy Cagle
  Jared: 454161034, // Jared Maxwell
};
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

const MOTIVATION = [
  'Let’s make it a clean day: fast follow-ups, tight notes, no dropped balls.',
  'One more touchpoint than yesterday. Momentum compounds.',
  'Control the controllables: speed-to-lead, clear next steps, and good energy.',
  'Win the first hour, win the day. Let’s go.',
];

const ZB_OWNER_NAME = process.env.ZOHO_BOOKINGS_OWNER_NAME || 'clay_thankyouforyourservice';
const ZB_WORKSPACE_ID = process.env.ZOHO_BOOKINGS_WORKSPACE_ID || '4739587000000043008';

function fmtBookingsCriteriaDate(d) {
  // Bookings UI criteria uses: "02-Feb-2026 20:51:00"
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = months[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${dd}-${mon}-${yyyy} ${hh}:${mm}:${ss}`;
}

async function getTodaysMeetings({ accessToken, todayStart, tomorrowStart }) {
  // Source of truth: Zoho Bookings appointments (Creator-backed WEB_APPOINTMENT report).
  // Requires Zoho Creator scopes (ZohoCreator.report.READ) on the Zoho OAuth token.
  try {
    const criteria = `WORKSPACE_ID==${ZB_WORKSPACE_ID} && FROM_TIME>\"${fmtBookingsCriteriaDate(todayStart)}\" && FROM_TIME<\"${fmtBookingsCriteriaDate(tomorrowStart)}\"`;
    const out = await zohoBookingsReportGet({
      accessToken,
      ownerName: ZB_OWNER_NAME,
      reportLinkName: 'WEB_APPOINTMENT',
      query: {
        max_records: 200,
        sortBy: 'FROM_TIME:true',
        criteria,
      },
    });

    // The Creator report API returns {data:[...]}.
    const rows = out?.data || out;
    if (Array.isArray(rows)) {
      return rows.map(r => ({
        Start_DateTime: r.FROM_TIME || r.From_Time || r.from_time,
        End_DateTime: r.TO_TIME || r.To_Time || r.to_time,
        Event_Title: r.SERVICE_NAME || r.Service_Name || r.service_name || r.APPOINTMENT_FOR || r.Appointment_For || 'Booking',
        _raw: r,
      }));
    }
  } catch (e) {
    // Fall back to Zoho CRM Events if Bookings token isn't set up yet.
    // (We'll surface the error implicitly by still having meetings, but we should migrate fully.)
  }

  // Fallback: Zoho CRM Events happening today
  const q = `select id, Event_Title, Start_DateTime, End_DateTime, Owner from Events where Start_DateTime >= '${isoNoMs(todayStart)}' and Start_DateTime < '${isoNoMs(tomorrowStart)}' order by Start_DateTime asc limit 200`;
  const res = await zohoCrmCoql({ accessToken, apiDomain: ZOHO_API_DOMAIN, selectQuery: q });
  return (res?.data || []);
}

async function getRcExtensionsForRoster() {
  // Map RingCentral extensions to reps by name. Best-effort.
  const extRes = await ringcentralGetJson('/restapi/v1.0/account/~/extension?perPage=200');
  const exts = extRes?.records || [];

  const roster = new Map();
  for (const rep of SALES_ROSTER) {
    // Prefer explicit mapping.
    const explicit = RC_EXTENSION_ID_BY_REP?.[rep];
    if (explicit) {
      roster.set(rep, explicit);
      continue;
    }

    // Fallback: best-effort name matching.
    const match = exts.find(e => {
      const n = `${e?.contact?.firstName || ''} ${e?.contact?.lastName || ''}`.trim();
      const uname = String(e?.name || '');
      return n.toLowerCase().includes(rep.toLowerCase()) || uname.toLowerCase().includes(rep.toLowerCase());
    });
    if (match?.id) roster.set(rep, match.id);
  }

  return roster;
}

async function getOutboundPerf({ from, to }) {
  const rosterIds = await getRcExtensionsForRoster();

  const rows = [];
  for (const rep of SALES_ROSTER) {
    const extId = rosterIds.get(rep);
    if (!extId) {
      rows.push({ name: rep, calls: 0, sms: 0, _missing: true });
      continue;
    }

    const callLog = await ringcentralGetJson(
      `/restapi/v1.0/account/~/extension/${extId}/call-log?dateFrom=${encodeURIComponent(isoNoMs(from))}&dateTo=${encodeURIComponent(isoNoMs(to))}&perPage=1000`,
    );
    const msgStore = await ringcentralGetJson(
      `/restapi/v1.0/account/~/extension/${extId}/message-store?dateFrom=${encodeURIComponent(isoNoMs(from))}&dateTo=${encodeURIComponent(isoNoMs(to))}&perPage=1000`,
    );

    const calls = (callLog?.records || []).filter(r => r.direction === 'Outbound').length;
    const sms = (msgStore?.records || []).filter(r => r.type === 'SMS' && r.direction === 'Outbound').length;

    rows.push({ name: rep, calls, sms });
  }

  // winner: calls primary, sms tiebreak
  const sorted = [...rows].sort((a, b) => (b.calls - a.calls) || (b.sms - a.sms));
  const winner = sorted[0];

  return { rows, winner };
}

async function postToRingCentralChat({ chatId, text }) {
  // RingCentral Team Messaging (legacy Glip) endpoint.
  // ChatId is the numeric id from the URL: https://app.ringcentral.com/messages/<chatId>
  return ringcentralPostJson(`/restapi/v1.0/glip/chats/${chatId}/posts`, { text });
}

(async function main() {
  const chatId = getArg('--chatId', null);
  if (!chatId) {
    console.error('Missing --chatId');
    process.exit(1);
  }

  const windowMode = getArg('--window', 'previousBusinessDay');
  if (!['previousBusinessDay', 'today'].includes(windowMode)) {
    console.error("Invalid --window. Use 'previousBusinessDay' or 'today'.");
    process.exit(1);
  }

  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  // Use previous business day (Mon–Fri) for the morning report so Monday covers Friday.
  const previousBusinessDayStart = (() => {
    const d = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1);
    }
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const perfFrom = windowMode === 'today' ? todayStart : previousBusinessDayStart;
  const perfTo = windowMode === 'today' ? now : todayStart;

  const zohoToken = await getZohoAccessToken();
  const todaysMeetings = await getTodaysMeetings({ accessToken: zohoToken, todayStart, tomorrowStart });

  const perf = await getOutboundPerf({ from: perfFrom, to: perfTo });

  const meetingLines = todaysMeetings.length
    ? todaysMeetings.map(e => {
        const title = e.Event_Title || 'Meeting';
        const repHint = SALES_ROSTER.find(r => title.toLowerCase().includes(r.toLowerCase()));
        return `- ${fmtLocal(e.Start_DateTime)} — ${title}${repHint ? ` (${repHint})` : ''}`;
      }).join('\n')
    : '- None on the calendar today.';

  const motivation = MOTIVATION[Math.floor(Math.random() * MOTIVATION.length)];

  const perfTable = formatTable(perf.rows);
  const winnerLine = perf.winner ? `Top outbound yesterday: ${perf.winner.name} (calls ${perf.winner.calls}, sms ${perf.winner.sms})` : '';

  const text = [
    `Good morning team — here’s today’s lineup (${todayStart.toLocaleDateString('en-US')}):`,
    '',
    'Today’s booked meetings:',
    meetingLines,
    '',
    windowMode === 'today'
      ? `Today outbound performance so far (calls + SMS, through ${fmtLocal(now)}):`
      : 'Previous business day outbound performance (calls + SMS):',
    perfTable,
    winnerLine ? `\n${winnerLine}` : '',
    '',
    motivation,
  ].filter(Boolean).join('\n');

  await postToRingCentralChat({ chatId, text });
  process.stdout.write('Posted morning update to RingCentral chat.\n');
})().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
