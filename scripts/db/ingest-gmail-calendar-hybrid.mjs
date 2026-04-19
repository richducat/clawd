#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { dbPath, ensureDbDir } from '../lib/db.mjs';
import { loadEnvLocal } from '../lib/env.mjs';
import { stableId } from '../lib/hybrid-db.mjs';
import { openSqlite } from '../lib/sqlite.mjs';

const args = process.argv.slice(2);

const account = getArg(args, '--account') || process.env.GOG_ACCOUNT || 'richducat@gmail.com';
const days = Number(getArg(args, '--days') || '1');
const max = Number(getArg(args, '--max') || '200');
const calendarId = getArg(args, '--calendarId') || 'primary';
const gmailJsonPath = getArg(args, '--gmail-json');
const calendarJsonPath = getArg(args, '--calendar-json');
const allowPartialSources = hasFlag(args, '--allow-partial-sources');
const connectorRetries = toSafeInt(getArg(args, '--connector-retries'), 2, 0, 10);
const connectorBackoffMs = toSafeInt(getArg(args, '--connector-backoff-ms'), 800, 0, 60_000);
const connectorBackoffFactor = toSafeFloat(getArg(args, '--connector-backoff-factor'), 2, 1, 10);

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

async function main() {
  loadEnvLocal();
  await ensureDbDir();

  const targetPath = dbPath('hybrid-core.sqlite');
  const db = openSqlite(targetPath);

  try {
    assertHybridSchemaReady(db);

    const now = new Date();
    const defaultSince = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const gmailCursor = readCursorIso(db, 'gmail', defaultSince.toISOString());
    const calendarCursor = readCursorIso(db, 'google_calendar', defaultSince.toISOString());

    const retryConfig = {
      retries: connectorRetries,
      backoffMs: connectorBackoffMs,
      backoffFactor: connectorBackoffFactor,
    };

    let gmailMessages = [];
    let calendarEvents = [];
    let gmailError = null;
    let calendarError = null;

    if (gmailJsonPath) {
      gmailMessages = normalizeGmailMessages(loadJsonFile(gmailJsonPath));
    } else {
      try {
        gmailMessages = await fetchGmailMessages({ account, max, sinceIso: gmailCursor, retryConfig });
      } catch (err) {
        gmailError = formatSourceError('gmail', err);
        if (!allowPartialSources) throw err;
      }
    }

    if (calendarJsonPath) {
      calendarEvents = normalizeCalendarEvents(loadJsonFile(calendarJsonPath));
    } else {
      try {
        calendarEvents = await fetchCalendarEvents({
          account,
          calendarId,
          sinceIso: calendarCursor,
          untilIso: now.toISOString(),
          retryConfig,
        });
      } catch (err) {
        calendarError = formatSourceError('google_calendar', err);
        if (!allowPartialSources) throw err;
      }
    }

    const state = {
      ok: true,
      status: 'ok',
      db: targetPath,
      config: {
        allow_partial_sources: allowPartialSources,
        connector_retry: retryConfig,
      },
      window: {
        gmail_since: gmailCursor,
        calendar_since: calendarCursor,
        until: now.toISOString(),
      },
      gmail: {
        source: gmailJsonPath ? path.resolve(gmailJsonPath) : 'gog',
        scanned: gmailMessages.length,
        upsertedMessages: 0,
        upsertedContacts: 0,
        upsertedLinks: 0,
        latestSeenAt: null,
        cursorUpdated: false,
        error: gmailError,
      },
      calendar: {
        source: calendarJsonPath ? path.resolve(calendarJsonPath) : 'gog',
        scanned: calendarEvents.length,
        upsertedEvents: 0,
        upsertedContacts: 0,
        upsertedLinks: 0,
        latestSeenAt: null,
        cursorUpdated: false,
        error: calendarError,
      },
    };

    const failedSources = [gmailError, calendarError].filter(Boolean);
    if (failedSources.length) {
      if (failedSources.length === 2) {
        state.ok = false;
        state.status = 'failed';
      } else {
        state.status = 'partial_failure';
      }
    }

    state.failures = failedSources;

    const tx = db.transaction(() => {
      for (const message of gmailMessages) {
        ingestGmailRecord(db, message, account, state.gmail);
      }

      for (const event of calendarEvents) {
        ingestCalendarRecord(db, event, account, state.calendar);
      }

      if (!state.gmail.error) {
        writeCursor(db, 'gmail', {
          last_ingested_at: state.window.until,
          latest_seen_at: state.gmail.latestSeenAt || gmailCursor,
          account,
        });
        state.gmail.cursorUpdated = true;
      }

      if (!state.calendar.error) {
        writeCursor(db, 'google_calendar', {
          last_ingested_at: state.window.until,
          latest_seen_at: state.calendar.latestSeenAt || calendarCursor,
          account,
          calendar_id: calendarId,
        });
        state.calendar.cursorUpdated = true;
      }
    });

    tx();

    console.log(JSON.stringify(state, null, 2));

    if (!state.ok) {
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

function ingestGmailRecord(db, message, account, summary) {
  const messageId = String(message.id || '').trim();
  if (!messageId) return;

  const ts = toIso(message.date);
  const subject = cleanLine(message.subject);
  const snippet = cleanLine(message.snippet, 500);
  const labels = Array.isArray(message.labels) ? message.labels : [];

  if (labels.includes('CATEGORY_PROMOTIONS') || labels.includes('CATEGORY_SOCIAL')) {
    return;
  }

  const messageExternalRef = `gmail:message:${messageId}`;
  const messageEntityId = stableId(`entity:${messageExternalRef}`);
  const messageBody = [
    subject ? `Subject: ${subject}` : null,
    snippet ? `Snippet: ${snippet}` : null,
    message.from ? `From: ${message.from}` : null,
    message.to ? `To: ${message.to}` : null,
    message.cc ? `Cc: ${message.cc}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  upsertEntity(db, {
    id: messageEntityId,
    domain: 'crm',
    type: 'gmail_message',
    externalRef: messageExternalRef,
    title: subject || '(no subject)',
    body: messageBody,
    metadata: {
      gmail_message_id: messageId,
      gmail_thread_id: message.threadId || null,
      labels,
      timestamp: ts,
    },
    sourceSystem: 'gmail',
  });
  upsertChunk(db, {
    entityId: messageEntityId,
    chunkIndex: 0,
    text: messageBody || '(no message metadata)',
  });

  summary.upsertedMessages += 1;
  summary.latestSeenAt = maxIso(summary.latestSeenAt, ts);

  const counterparties = extractMessageCounterparties(message, account);
  for (const contact of counterparties) {
    const contactEntityId = upsertContactEntity(db, contact, ts);
    upsertLink(db, {
      fromEntityId: messageEntityId,
      toEntityId: contactEntityId,
      relationType: 'gmail_counterparty',
      confidence: 1,
      metadata: {
        role: contact.role,
      },
    });
    summary.upsertedContacts += 1;
    summary.upsertedLinks += 1;
  }
}

function ingestCalendarRecord(db, event, account, summary) {
  const seed = String(event.id || `${event.summary || ''}:${event.start || ''}`);
  if (!seed.trim()) return;

  const eventId = String(event.id || stableId(`calendar:event:${seed}`));
  const ts = toIso(event.start || event.created || event.updated);
  const title = cleanLine(event.summary || event.title || '(untitled event)');
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];

  const eventExternalRef = `calendar:event:${eventId}`;
  const eventEntityId = stableId(`entity:${eventExternalRef}`);
  const eventBody = [
    title ? `Summary: ${title}` : null,
    event.start ? `Start: ${toIso(event.start)}` : null,
    event.end ? `End: ${toIso(event.end)}` : null,
    attendees.length ? `Attendees: ${attendees.map((a) => a.email || a).filter(Boolean).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  upsertEntity(db, {
    id: eventEntityId,
    domain: 'crm',
    type: 'calendar_event',
    externalRef: eventExternalRef,
    title,
    body: eventBody,
    metadata: {
      calendar_event_id: eventId,
      start: event.start || null,
      end: event.end || null,
      timestamp: ts,
    },
    sourceSystem: 'google_calendar',
  });
  upsertChunk(db, {
    entityId: eventEntityId,
    chunkIndex: 0,
    text: eventBody || '(no event metadata)',
  });

  summary.upsertedEvents += 1;
  summary.latestSeenAt = maxIso(summary.latestSeenAt, ts);

  for (const attendee of attendees) {
    const email = normalizeEmail(attendee.email || attendee);
    if (!email || email === normalizeEmail(account)) continue;

    const contactEntityId = upsertContactEntity(db, { email, name: attendee.displayName || null }, ts);
    upsertLink(db, {
      fromEntityId: eventEntityId,
      toEntityId: contactEntityId,
      relationType: 'calendar_attendee',
      confidence: 1,
      metadata: {
        response_status: attendee.responseStatus || null,
      },
    });

    summary.upsertedContacts += 1;
    summary.upsertedLinks += 1;
  }
}

function upsertContactEntity(db, contact, ts) {
  const email = normalizeEmail(contact.email);
  const name = cleanLine(contact.name || null);
  const externalRef = `contact:${email}`;
  const entityId = stableId(`entity:${externalRef}`);

  upsertEntity(db, {
    id: entityId,
    domain: 'crm',
    type: 'contact',
    externalRef,
    title: name || email,
    body: name ? `${name} <${email}>` : email,
    metadata: {
      email,
      name,
      last_seen_at: ts,
    },
    sourceSystem: 'identity',
  });

  upsertChunk(db, {
    entityId,
    chunkIndex: 0,
    text: name ? `${name} <${email}>` : email,
  });

  return entityId;
}

function upsertEntity(db, record) {
  db.prepare(`
    INSERT INTO entities (
      id, domain, type, external_ref, title, body,
      metadata_json, source_system, updated_at
    ) VALUES (
      @id, @domain, @type, @external_ref, @title, @body,
      @metadata_json, @source_system, CURRENT_TIMESTAMP
    )
    ON CONFLICT(id) DO UPDATE SET
      domain = excluded.domain,
      type = excluded.type,
      external_ref = excluded.external_ref,
      title = excluded.title,
      body = excluded.body,
      metadata_json = excluded.metadata_json,
      source_system = excluded.source_system,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    id: record.id,
    domain: record.domain,
    type: record.type,
    external_ref: record.externalRef || null,
    title: record.title || null,
    body: record.body || null,
    metadata_json: JSON.stringify(record.metadata || {}),
    source_system: record.sourceSystem || null,
  });
}

function upsertChunk(db, { entityId, chunkIndex, text }) {
  const chunkId = stableId(`chunk:${entityId}:${chunkIndex}`);
  db.prepare(`
    INSERT INTO entity_chunks (
      id, entity_id, chunk_index, text, token_count
    ) VALUES (
      @id, @entity_id, @chunk_index, @text, @token_count
    )
    ON CONFLICT(entity_id, chunk_index) DO UPDATE SET
      id = excluded.id,
      text = excluded.text,
      token_count = excluded.token_count
  `).run({
    id: chunkId,
    entity_id: entityId,
    chunk_index: chunkIndex,
    text,
    token_count: estimateTokenCount(text),
  });
}

function upsertLink(db, link) {
  db.prepare(`
    INSERT INTO entity_links (
      from_entity_id, to_entity_id, relation_type, confidence, metadata_json
    ) VALUES (
      @from_entity_id, @to_entity_id, @relation_type, @confidence, @metadata_json
    )
    ON CONFLICT(from_entity_id, to_entity_id, relation_type) DO UPDATE SET
      confidence = excluded.confidence,
      metadata_json = excluded.metadata_json
  `).run({
    from_entity_id: link.fromEntityId,
    to_entity_id: link.toEntityId,
    relation_type: link.relationType,
    confidence: link.confidence ?? null,
    metadata_json: JSON.stringify(link.metadata || {}),
  });
}

function readCursorIso(db, source, fallbackIso) {
  const row = db.prepare('SELECT cursor_json FROM ingestion_cursors WHERE source = ?').get(source);
  if (!row?.cursor_json) return fallbackIso;
  try {
    const parsed = JSON.parse(row.cursor_json);
    return toIso(parsed.latest_seen_at || parsed.last_ingested_at || fallbackIso);
  } catch {
    return fallbackIso;
  }
}

function writeCursor(db, source, payload) {
  db.prepare(`
    INSERT INTO ingestion_cursors (source, cursor_json, updated_at)
    VALUES (@source, @cursor_json, CURRENT_TIMESTAMP)
    ON CONFLICT(source) DO UPDATE SET
      cursor_json = excluded.cursor_json,
      updated_at = CURRENT_TIMESTAMP
  `).run({ source, cursor_json: JSON.stringify(payload) });
}

async function fetchGmailMessages({ account, max, sinceIso, retryConfig }) {
  const afterEpoch = Math.floor(new Date(sinceIso).getTime() / 1000);
  const query = `after:${afterEpoch} -category:promotions -category:social`;
  const list = await gogJson(
    ['gmail', 'messages', 'search', query, '--max', String(max), '--account', account, '--json'],
    retryConfig,
    'gmail.messages.search',
  );
  const messages = list?.messages || [];

  const out = [];
  for (const message of messages) {
    const full = await gogJson(
      ['gmail', 'get', message.id, '--account', account, '--json'],
      retryConfig,
      `gmail.get:${message.id}`,
    );
    out.push({
      id: message.id,
      threadId: message.threadId || full?.threadId || null,
      date: full?.date || message.date || null,
      subject: full?.subject || message.subject || '',
      snippet: full?.snippet || message.snippet || '',
      from: full?.from || message.from || '',
      to: full?.to || message.to || '',
      cc: full?.cc || message.cc || '',
      labels: message.labels || full?.labels || [],
    });
  }

  return out;
}

async function fetchCalendarEvents({ account, calendarId, sinceIso, untilIso, retryConfig }) {
  const raw = await gogJson(
    [
    'calendar',
    'events',
    calendarId,
    '--from',
    sinceIso,
    '--to',
    untilIso,
    '--account',
    account,
    '--json',
    ],
    retryConfig,
    'calendar.events',
  );

  return normalizeCalendarEvents(raw);
}

function normalizeGmailMessages(raw) {
  const messages = raw?.messages || raw;
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => ({
    id: m.id || m.messageId || null,
    threadId: m.threadId || null,
    date: m.date || m.internalDate || null,
    subject: m.subject || '',
    snippet: m.snippet || '',
    from: m.from || '',
    to: m.to || '',
    cc: m.cc || '',
    labels: m.labels || [],
  }));
}

function normalizeCalendarEvents(raw) {
  const events = raw?.events || raw?.items || raw;
  if (!Array.isArray(events)) return [];

  return events.map((event) => ({
    id: event.id || null,
    summary: event.summary || event.title || '',
    start: event.start?.dateTime || event.start?.date || event.start || null,
    end: event.end?.dateTime || event.end?.date || event.end || null,
    created: event.created || null,
    updated: event.updated || null,
    attendees: (event.attendees || []).map((attendee) => ({
      email: attendee.email || null,
      displayName: attendee.displayName || attendee.name || null,
      responseStatus: attendee.responseStatus || null,
    })),
  }));
}

function extractMessageCounterparties(message, account) {
  const me = normalizeEmail(account);
  const from = parseMailbox(message.from);
  const to = parseMailboxList(message.to);
  const cc = parseMailboxList(message.cc);

  const contacts = [];

  if (from.email && from.email === me) {
    for (const recipient of [...to, ...cc]) {
      if (!recipient.email || recipient.email === me) continue;
      contacts.push({ email: recipient.email, name: recipient.name || null, role: 'recipient' });
    }
  } else if (from.email && from.email !== me) {
    contacts.push({ email: from.email, name: from.name || null, role: 'sender' });
  }

  // de-dup email addresses while preserving first seen name/role
  const map = new Map();
  for (const contact of contacts) {
    if (!map.has(contact.email)) map.set(contact.email, contact);
  }

  return [...map.values()];
}

function parseMailboxList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => parseMailbox(s))
    .filter((m) => m.email);
}

function parseMailbox(raw) {
  if (!raw) return { email: null, name: null };

  const trimmed = String(raw).trim();
  const match = trimmed.match(/^(.*)<([^>]+)>\s*$/);

  if (match) {
    return {
      email: normalizeEmail(match[2]),
      name: cleanLine(match[1].replace(/^"|"$/g, '')) || null,
    };
  }

  if (!trimmed.includes('@')) return { email: null, name: null };

  return {
    email: normalizeEmail(trimmed),
    name: null,
  };
}

function normalizeEmail(value) {
  if (!value) return null;
  const email = String(value).trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function cleanLine(value, maxLen = 240) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function estimateTokenCount(text) {
  if (!text) return 0;
  // Conservative rough estimate for retrieval chunking metadata.
  return Math.ceil(String(text).length / 4);
}

function loadJsonFile(file) {
  const fullPath = path.resolve(file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(raw);
}

function assertHybridSchemaReady(db) {
  const requiredTables = ['entities', 'entity_chunks', 'entity_links', 'ingestion_cursors'];
  const rows = db
    .prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (${requiredTables.map(() => '?').join(',')})
    `)
    .all(...requiredTables);

  const found = new Set(rows.map((r) => r.name));
  const missing = requiredTables.filter((t) => !found.has(t));

  if (missing.length) {
    throw new Error(
      `Missing required table(s): ${missing.join(', ')}. Run \"npm run db:hybrid:init\" first.`,
    );
  }
}

async function gogJson(cmd, retryConfig, label) {
  const retries = toSafeInt(retryConfig?.retries, 2, 0, 10);
  const backoffMs = toSafeInt(retryConfig?.backoffMs, 800, 0, 60_000);
  const backoffFactor = toSafeFloat(retryConfig?.backoffFactor, 2, 1, 10);
  let attempt = 0;
  let delayMs = backoffMs;

  while (attempt <= retries) {
    attempt += 1;
    try {
      const out = execFileSync('gog', cmd, { encoding: 'utf8' });
      return JSON.parse(out);
    } catch (err) {
      const detail = err?.stderr ? String(err.stderr) : err?.message || String(err);
      if (attempt > retries) {
        throw new Error(
          `Failed to execute gog (${label || ['gog', ...cmd].join(' ')}) after ${attempt} attempt(s). ` +
            `Either configure gog credentials or run with --gmail-json/--calendar-json fixtures. ${detail}`,
        );
      }

      if (delayMs > 0) {
        await sleep(delayMs);
      }
      delayMs = Math.round(delayMs * backoffFactor);
    }
  }

  throw new Error(`Unexpected retry state for ${label || ['gog', ...cmd].join(' ')}`);
}

function getArg(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] || null;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function toSafeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function toSafeFloat(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function formatSourceError(source, err) {
  return {
    source,
    message: err?.message || String(err),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
