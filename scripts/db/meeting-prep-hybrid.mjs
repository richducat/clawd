#!/usr/bin/env node
import { dbPath } from '../lib/db.mjs';
import { loadEnvLocal } from '../lib/env.mjs';
import { openSqlite } from '../lib/sqlite.mjs';

const args = process.argv.slice(2);
const account = normalizeEmail(getArg(args, '--account') || process.env.GOG_ACCOUNT || 'richducat@gmail.com');
const dateArg = getArg(args, '--date');
const limit = toSafeInt(getArg(args, '--limit'), 50, 1, 500);
const jsonMode = hasFlag(args, '--json');
const internalDomainArgs = getArgValues(args, '--internal-domain')
  .map((d) => normalizeDomain(d))
  .filter(Boolean);

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

async function main() {
  loadEnvLocal();

  const targetDate = parseTargetDate(dateArg);
  const dayStart = new Date(targetDate.year, targetDate.month - 1, targetDate.day, 0, 0, 0, 0);
  const dayEnd = new Date(targetDate.year, targetDate.month - 1, targetDate.day, 23, 59, 59, 999);

  const internalDomains = dedupeArray([
    extractDomain(account),
    'thankyouforyourservice.co',
    ...internalDomainArgs,
  ].filter(Boolean));

  const db = openSqlite(dbPath('hybrid-core.sqlite'), { readonly: true });
  try {
    assertHybridSchemaReady(db);

    const events = db.prepare(`
      SELECT id, title, metadata_json
      FROM entities
      WHERE domain = 'crm' AND type = 'calendar_event'
      ORDER BY COALESCE(json_extract(metadata_json, '$.start'), json_extract(metadata_json, '$.timestamp'), updated_at) ASC
      LIMIT ?
    `).all(limit * 20);

    const attendeeStmt = db.prepare(`
      SELECT c.id, c.title, c.metadata_json
      FROM entity_links l
      JOIN entities c ON c.id = l.to_entity_id
      WHERE l.from_entity_id = ? AND l.relation_type = 'calendar_attendee'
      ORDER BY c.title COLLATE NOCASE ASC, c.id ASC
    `);

    const recentTouchesStmt = db.prepare(`
      SELECT g.title, g.metadata_json
      FROM entity_links l
      JOIN entities g ON g.id = l.from_entity_id
      WHERE l.to_entity_id = ?
        AND l.relation_type = 'gmail_counterparty'
        AND g.domain = 'crm'
        AND g.type = 'gmail_message'
      ORDER BY COALESCE(json_extract(g.metadata_json, '$.timestamp'), g.updated_at) DESC, g.updated_at DESC
      LIMIT 25
    `);

    const briefs = [];
    for (const event of events) {
      if (briefs.length >= limit) break;
      const metadata = safeJson(event.metadata_json);
      const startIso = eventStartIso(metadata);
      if (!startIso) continue;

      const start = new Date(startIso);
      if (Number.isNaN(start.getTime())) continue;
      if (start < dayStart || start > dayEnd) continue;

      const attendees = attendeeStmt.all(event.id)
        .map((row) => normalizeAttendee(row))
        .filter((a) => a.email);

      const externalAttendees = attendees.filter((a) => isExternalAttendee(a.email, account, internalDomains));
      if (!externalAttendees.length) continue;

      const attendeeBriefs = externalAttendees.map((attendee) => {
        const touchRows = recentTouchesStmt.all(attendee.entityId).map(normalizeTouchRow);
        const relationshipSnapshot = buildRelationshipSnapshot(touchRows);
        const recommendedNextActions = buildRecommendedNextActions({
          attendee,
          snapshot: relationshipSnapshot,
          meetingStartIso: start.toISOString(),
        });

        return {
          email: attendee.email,
          name: attendee.name,
          responseStatus: attendee.responseStatus,
          lastTouch: relationshipSnapshot.lastTouch,
          relationshipSnapshot,
          recommendedNextActions,
        };
      });

      briefs.push({
        eventId: event.id,
        title: cleanLine(event.title || '(untitled event)', 180),
        start: start.toISOString(),
        end: toIsoOrNull(metadata?.end),
        attendees: attendeeBriefs,
      });
    }

    if (jsonMode) {
      console.log(JSON.stringify({
        account,
        date: toYmd(dayStart),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
        internalDomains,
        meetings: briefs,
      }, null, 2));
      return;
    }

    printMarkdownBrief({
      account,
      date: toYmd(dayStart),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
      internalDomains,
      meetings: briefs,
    });
  } finally {
    db.close();
  }
}

function printMarkdownBrief({ account, date, timezone, internalDomains, meetings }) {
  console.log(`# Meeting Prep Brief (${date})`);
  console.log('');
  console.log(`- Account: ${account}`);
  console.log(`- Timezone: ${timezone}`);
  console.log(`- Internal domains: ${internalDomains.join(', ')}`);
  console.log(`- External meetings: ${meetings.length}`);
  console.log('');

  if (!meetings.length) {
    console.log('No external meetings found for this date.');
    return;
  }

  for (const meeting of meetings) {
    console.log(`## ${toLocalHm(meeting.start)} - ${meeting.title}`);
    for (const attendee of meeting.attendees) {
      const who = attendee.name ? `${attendee.name} <${attendee.email}>` : attendee.email;
      if (attendee.lastTouch) {
        console.log(`- ${who}: last touch ${attendee.lastTouch.date} - ${attendee.lastTouch.subject}`);
      } else {
        console.log(`- ${who}: no prior Gmail touchpoint found`);
      }
      const snapshot = attendee.relationshipSnapshot || {};
      console.log(
        `  - Snapshot: 7d=${snapshot.touchpoints7d || 0}, 30d=${snapshot.touchpoints30d || 0}, 90d=${snapshot.touchpoints90d || 0}`
      );
      if (Array.isArray(snapshot.recentSubjects) && snapshot.recentSubjects.length) {
        console.log(`  - Recent subjects: ${snapshot.recentSubjects.join(' | ')}`);
      }
      if (Array.isArray(attendee.recommendedNextActions) && attendee.recommendedNextActions.length) {
        for (const action of attendee.recommendedNextActions) {
          console.log(`  - Next action: ${action}`);
        }
      }
    }
    console.log('');
  }
}

function normalizeTouchRow(row) {
  const metadata = safeJson(row?.metadata_json);
  const ts = toIsoOrNull(metadata?.timestamp);
  return {
    timestamp: ts,
    date: ts ? ts.slice(0, 10) : null,
    subject: cleanLine(row?.title || '', 180) || '(no subject)',
  };
}

function buildRelationshipSnapshot(touches) {
  const now = Date.now();
  const withTime = touches
    .map((t) => ({
      ...t,
      ms: t.timestamp ? Date.parse(t.timestamp) : Number.NaN,
    }))
    .filter((t) => Number.isFinite(t.ms));

  const inDays = (days) => {
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    return withTime.filter((t) => t.ms >= cutoff).length;
  };

  return {
    touchpoints7d: inDays(7),
    touchpoints30d: inDays(30),
    touchpoints90d: inDays(90),
    recentSubjects: withTime.slice(0, 3).map((t) => `${t.date}: ${t.subject}`),
    lastTouch: withTime.length ? {
      date: withTime[0].date,
      timestamp: withTime[0].timestamp,
      subject: withTime[0].subject,
    } : null,
  };
}

function buildRecommendedNextActions({ attendee, snapshot, meetingStartIso }) {
  const actions = [];
  const lastTouch = snapshot?.lastTouch || null;
  const response = (attendee?.responseStatus || '').toLowerCase();
  const meetingStartMs = Date.parse(meetingStartIso);

  if (!lastTouch) {
    actions.push('Send a first-touch note with agenda and objective before the meeting.');
  } else {
    const lastTouchMs = Date.parse(lastTouch.timestamp);
    const ageDays = Number.isFinite(lastTouchMs)
      ? Math.floor((Date.now() - lastTouchMs) / (24 * 60 * 60 * 1000))
      : null;

    if (ageDays !== null && ageDays > 30) {
      actions.push(`Re-open the ${lastTouch.date} thread ("${lastTouch.subject}") with refreshed context and explicit next step.`);
    } else if (ageDays !== null && ageDays > 7) {
      actions.push(`Send a short pre-meeting follow-up on "${lastTouch.subject}" to confirm priorities.`);
    } else {
      actions.push(`Continue in the existing "${lastTouch.subject}" thread and close with one clear decision ask.`);
    }
  }

  if (response === 'needsaction' || response === 'tentative') {
    actions.push('Request attendance confirmation before start time.');
  }
  if (response === 'declined') {
    actions.push('Decide whether to proceed without this attendee or reschedule with an alternate slot.');
  }

  const touchpoints30d = Number(snapshot?.touchpoints30d || 0);
  if (touchpoints30d >= 3) {
    actions.push('Prepare a concise progress recap from recent touchpoints to avoid repeating context.');
  }

  if (Number.isFinite(meetingStartMs)) {
    const hoursToMeeting = (meetingStartMs - Date.now()) / (60 * 60 * 1000);
    if (hoursToMeeting >= 0 && hoursToMeeting <= 6) {
      actions.push('Share a one-line agenda/check-in message now due to near-term meeting start.');
    }
  }

  return dedupeArray(actions).slice(0, 4);
}

function normalizeAttendee(row) {
  const metadata = safeJson(row.metadata_json);
  return {
    entityId: row.id,
    email: normalizeEmail(metadata?.email),
    name: cleanLine(metadata?.name || row.title || '', 120) || null,
    responseStatus: cleanLine(metadata?.response_status || '', 32) || null,
  };
}

function eventStartIso(metadata) {
  return toIsoOrNull(metadata?.start) || toIsoOrNull(metadata?.timestamp);
}

function isExternalAttendee(email, accountEmail, internalDomains) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (normalized === accountEmail) return false;
  const domain = extractDomain(normalized);
  if (!domain) return true;
  return !internalDomains.includes(domain);
}

function parseTargetDate(raw) {
  if (!raw) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }

  const match = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('Invalid --date value. Use YYYY-MM-DD.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('Invalid --date value. Use YYYY-MM-DD.');
  }

  return { year, month, day };
}

function assertHybridSchemaReady(db) {
  const required = ['entities', 'entity_chunks', 'entity_links'];
  const rows = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name IN (${required.map(() => '?').join(',')})
  `).all(...required);

  const present = new Set(rows.map((r) => r.name));
  const missing = required.filter((name) => !present.has(name));
  if (missing.length) {
    throw new Error(`Missing required tables: ${missing.join(', ')}. Run npm run db:hybrid:init first.`);
  }
}

function getArg(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || null;
}

function getArgValues(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) values.push(argv[i + 1]);
  }
  return values;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function toSafeInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeEmail(value) {
  if (!value) return null;
  const email = String(value).trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function normalizeDomain(value) {
  if (!value) return null;
  return String(value).trim().toLowerCase().replace(/^@/, '') || null;
}

function extractDomain(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const idx = normalized.lastIndexOf('@');
  if (idx === -1) return null;
  return normalized.slice(idx + 1);
}

function safeJson(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function toIsoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toLocalHm(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '??:??';
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function cleanLine(value, maxLen = 240) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function dedupeArray(values) {
  return [...new Set(values)];
}
