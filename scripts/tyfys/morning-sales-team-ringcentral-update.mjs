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
 *   node scripts/tyfys/morning-sales-team-ringcentral-update.mjs --chatId 144856375302 --dry-run
 *   node scripts/tyfys/morning-sales-team-ringcentral-update.mjs --selftest
 *
 * Options:
 *   --window previousBusinessDay|today   (default: previousBusinessDay)
 *   --concurrency <n>                   (default: 3) max parallel RC requests (non-selftest)
 */

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoBookingsReportGet } from '../lib/zoho.mjs';
import { ringcentralGetJson, ringcentralPostJson } from '../lib/ringcentral.mjs';

const selftest = process.argv.includes('--selftest');
if (!selftest) loadEnvLocal();

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
  const safeRows = Array.isArray(rows) ? rows : [];
  const maxName = Math.max(3, ...safeRows.map(r => (r?.name || '').length));
  return safeRows
    .map(r => `${String(r.name || '').padEnd(maxName)}  calls:${String(r.calls || 0).padStart(3)}  sms:${String(r.sms || 0).padStart(3)}`)
    .join('\n');
}

function pLimit(concurrency) {
  const c = Math.max(1, Number(concurrency) || 1);
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= c) return;
    const item = queue.shift();
    if (!item) return;

    active += 1;
    Promise.resolve()
      .then(item.fn)
      .then(item.resolve, item.reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

const SALES_ROSTER = ['Adam', 'Amy', 'Jared'];
const tenant = getArg('--tenant', 'new'); // RingCentral tenant/app namespace (default: new)

// NOTE: Extension ids differ between RingCentral tenants/accounts.
// We prefer name matching against the live extension directory.
const RC_EXTENSION_ID_BY_REP = {};
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
  const extRes = await ringcentralGetJson('/restapi/v1.0/account/~/extension?perPage=200', { tenant });
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

function toAbsPath(basePath, maybeRelative) {
  // Returns path+query, using a dummy origin.
  try {
    if (!maybeRelative) return null;
    const abs = new URL(maybeRelative, `https://example.com${basePath || ''}`);
    return abs.pathname + abs.search;
  } catch {
    return null;
  }
}

async function ringcentralGetAllRecords(pathAndQuery, { tenant, maxPages = 25 } = {}) {
  // Supports common RingCentral paging shapes:
  //  - { records: [...], navigation: { nextPage: { uri } } }
  //  - { records: [...], paging: { page, totalPages } }
  const out = [];
  let next = pathAndQuery;
  let pages = 0;

  while (next && pages < maxPages) {
    pages += 1;
    const json = await ringcentralGetJson(next, { tenant });
    out.push(...(json?.records || []));

    const nextUri = json?.navigation?.nextPage?.uri || json?.navigation?.nextPage?.href || null;
    if (nextUri) {
      next = toAbsPath('/restapi/v1.0', nextUri) || nextUri;
      continue;
    }

    const page = Number(json?.paging?.page || 0);
    const totalPages = Number(json?.paging?.totalPages || 0);
    if (page && totalPages && page < totalPages) {
      // Reconstruct URL with page+1.
      const u = new URL('https://example.com' + next);
      u.searchParams.set('page', String(page + 1));
      next = u.pathname + u.search;
      continue;
    }

    next = null;
  }

  return out;
}

async function getOutboundPerf({ from, to }) {
  const rosterIds = await getRcExtensionsForRoster();

  // RingCentral APIs are fairly fast, but sequential per-rep calls can stack up.
  // We parallelize with a small cap to avoid hammering the API / triggering throttles.
  const limit = pLimit(Number(getArg('--concurrency', '3')));

  const tasks = SALES_ROSTER.map(rep => limit(async () => {
    const extId = rosterIds.get(rep);
    if (!extId) return { name: rep, calls: 0, sms: 0, _missing: true };

    const dateFrom = encodeURIComponent(isoNoMs(from));
    const dateTo = encodeURIComponent(isoNoMs(to));

    const [callRecords, msgRecords] = await Promise.all([
      ringcentralGetAllRecords(`/restapi/v1.0/account/~/extension/${extId}/call-log?dateFrom=${dateFrom}&dateTo=${dateTo}&perPage=1000&page=1`, { tenant }),
      ringcentralGetAllRecords(`/restapi/v1.0/account/~/extension/${extId}/message-store?dateFrom=${dateFrom}&dateTo=${dateTo}&perPage=1000&page=1`, { tenant }),
    ]);

    const calls = callRecords.filter(r => r.direction === 'Outbound').length;
    const sms = msgRecords.filter(r => r.type === 'SMS' && r.direction === 'Outbound').length;

    return { name: rep, calls, sms };
  }));

  const rows = await Promise.all(tasks);

  // winner: calls primary, sms tiebreak
  const sorted = [...rows].sort((a, b) => (b.calls - a.calls) || (b.sms - a.sms));
  const winner = sorted[0];

  return { rows, winner };
}

async function postToRingCentralChat({ chatId, text }) {
  // RingCentral Team Messaging (legacy Glip) endpoint.
  // ChatId is the numeric id from the URL: https://app.ringcentral.com/messages/<chatId>
  return ringcentralPostJson(`/restapi/v1.0/glip/chats/${chatId}/posts`, { text }, { tenant });
}

(async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (selftest) {
    const fakeMeetings = [
      { Start_DateTime: new Date('2026-02-13T14:00:00Z').toISOString(), Event_Title: 'Intake — Adam' },
      { Start_DateTime: new Date('2026-02-13T16:30:00Z').toISOString(), Event_Title: 'Follow-up — Jared' },
    ];

    const fakePerf = {
      rows: [
        { name: 'Adam', calls: 23, sms: 11 },
        { name: 'Amy', calls: 18, sms: 9 },
        { name: 'Jared', calls: 15, sms: 7 },
      ],
      winner: { name: 'Adam', calls: 23, sms: 11 },
    };

    const meetingLines = fakeMeetings.map(e => `- ${fmtLocal(e.Start_DateTime)} — ${e.Event_Title}`).join('\n');
    const perfTable = formatTable(fakePerf.rows);
    const winnerLine = `Top outbound yesterday: ${fakePerf.winner.name} (calls ${fakePerf.winner.calls}, sms ${fakePerf.winner.sms})`;

    const text = [
      `Good morning team — here’s today’s lineup (${new Date().toLocaleDateString('en-US')}):`,
      '',
      'Today’s booked meetings:',
      meetingLines,
      '',
      'Previous business day outbound performance (calls + SMS):',
      perfTable,
      `\n${winnerLine}`,
      '',
      '(selftest) Let’s have a clean day: fast follow-ups, tight notes, no dropped balls.',
    ].filter(Boolean).join('\n');

    process.stdout.write(text + '\n');
    return;
  }

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

  if (dryRun) {
    process.stdout.write(`[dry-run] Would post to chatId=${chatId}:\n\n${text}\n`);
    return;
  }

  await postToRingCentralChat({ chatId, text });
  process.stdout.write('Posted morning update to RingCentral chat.\n');
})().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
