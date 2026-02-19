#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { loadEnvLocal } from '../lib/env.mjs';

loadEnvLocal();
import crypto from 'node:crypto';
import { openCrmDb, upsertContactFromInteraction } from './crm-db.mjs';

/**
 * Minimal Personal CRM ingest (v1):
 * - Gmail: scan recent messages, extract counterparty contact(s)
 * - Calendar: scan recent events, extract attendee emails
 * - Persist contacts + interactions into a Drive-synced sqlite DB.
 *
 * This is intentionally conservative:
 * - skips obvious newsletters (heuristic by label categories)
 * - only stores metadata + small snippets (not full bodies) by default
 */

const args = process.argv.slice(2);
const account = getArg(args, '--account') || process.env.GOG_ACCOUNT || 'richducat@gmail.com';
const days = Number(getArg(args, '--days') || '1');
const max = Number(getArg(args, '--max') || '200');
const calendarId = getArg(args, '--calendarId') || 'primary';

const { db, path } = openCrmDb();

const now = new Date();
const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const summary = {
  db: path,
  gmail: { scanned: 0, savedInteractions: 0, savedContacts: 0 },
  calendar: { scanned: 0, savedInteractions: 0, savedContacts: 0 },
};

// --- Gmail ingest ---
{
  const query = `newer_than:${days}d -category:promotions -category:social`;
  const list = gogJson(['gmail', 'messages', 'search', query, '--max', String(max), '--account', account, '--json']);
  const messages = list?.messages || [];
  summary.gmail.scanned = messages.length;

  const insertInteraction = db.prepare(`
    INSERT OR IGNORE INTO interactions
      (id, contact_email, kind, ts, subject, snippet, message_id, thread_id, raw_json)
    VALUES
      (@id, @contact_email, 'gmail', @ts, @subject, @snippet, @message_id, @thread_id, @raw_json)
  `);

  const beforeContacts = db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;

  for (const m of messages) {
    // Pull metadata for headers to/from/cc
    const full = gogJson(['gmail', 'get', m.id, '--account', account, '--json']);

    const labels = m.labels || [];
    if (labels.includes('CATEGORY_PROMOTIONS') || labels.includes('CATEGORY_SOCIAL')) continue;

    const ts = toIso(full?.date || m.date);
    const subject = (full?.subject || m.subject || '').trim();
    const snippet = (full?.snippet || '').slice(0, 280);

    const { fromEmail, fromName } = parseEmail(full?.from || m.from);
    const toEmails = parseEmails(full?.to);
    const ccEmails = parseEmails(full?.cc);

    // Counterparty heuristic:
    // - if email is FROM me → counterparties are TO + CC
    // - else → counterparty is FROM
    const me = account.toLowerCase();
    const counterparties = [];

    if (fromEmail && fromEmail.toLowerCase() === me) {
      for (const e of [...toEmails, ...ccEmails]) {
        if (e.toLowerCase() === me) continue;
        counterparties.push({ email: e, name: null });
      }
    } else if (fromEmail) {
      if (fromEmail.toLowerCase() !== me) counterparties.push({ email: fromEmail, name: fromName });
    }

    for (const c of counterparties) {
      // Upsert contact first (interactions has FK constraint).
      upsertContactFromInteraction(db, {
        email: c.email,
        name: c.name,
        ts,
        subject,
        snippet,
        source: 'gmail',
      });

      const id = stableInteractionId('gmail', m.id, c.email);
      const res = insertInteraction.run({
        id,
        contact_email: c.email,
        ts,
        subject,
        snippet,
        message_id: m.id,
        thread_id: m.threadId,
        raw_json: JSON.stringify({ from: full?.from, to: full?.to, cc: full?.cc, labels }),
      });

      if (res.changes) {
        summary.gmail.savedInteractions += 1;
      }
    }
  }

  const afterContacts = db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;
  summary.gmail.savedContacts = Math.max(0, afterContacts - beforeContacts);
}

// --- Calendar ingest ---
{
  const fromIso = from.toISOString();
  const toIsoStr = now.toISOString();

  const events = gogJson(['calendar', 'events', calendarId, '--from', fromIso, '--to', toIsoStr, '--account', account, '--json']);
  const items = events?.events || events?.items || events || [];

  const insertInteraction = db.prepare(`
    INSERT OR IGNORE INTO interactions
      (id, contact_email, kind, ts, subject, snippet, event_id, raw_json)
    VALUES
      (@id, @contact_email, 'calendar', @ts, @subject, @snippet, @event_id, @raw_json)
  `);

  const beforeContacts = db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;

  for (const ev of Array.isArray(items) ? items : []) {
    summary.calendar.scanned += 1;

    const summaryText = (ev.summary || ev.title || '').trim();
    const ts = toIso(ev.start?.dateTime || ev.start?.date || ev.start || ev.created || ev.updated);

    const attendees = (ev.attendees || []).map((a) => a.email).filter(Boolean);
    // Exclude self
    const counterparties = attendees.filter((e) => e.toLowerCase() !== account.toLowerCase());

    for (const email of counterparties) {
      // Upsert contact first (interactions has FK constraint).
      upsertContactFromInteraction(db, {
        email,
        name: null,
        ts,
        subject: summaryText,
        snippet: 'Calendar event attendee',
        source: 'calendar',
      });

      const id = stableInteractionId('calendar', ev.id || summaryText + ts, email);
      const res = insertInteraction.run({
        id,
        contact_email: email,
        ts,
        subject: summaryText,
        snippet: 'Calendar event attendee',
        event_id: ev.id || null,
        raw_json: JSON.stringify({ eventId: ev.id, start: ev.start, end: ev.end, attendees: ev.attendees || [] }),
      });

      if (res.changes) {
        summary.calendar.savedInteractions += 1;
      }
    }
  }

  const afterContacts = db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;
  summary.calendar.savedContacts = Math.max(0, afterContacts - beforeContacts);
}

console.log(JSON.stringify(summary, null, 2));

function gogJson(cmd) {
  const out = execFileSync('gog', cmd, { encoding: 'utf8' });
  return JSON.parse(out);
}

function getArg(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || null;
}

function parseEmails(s) {
  if (!s) return [];
  return String(s)
    .split(',')
    .map((p) => p.trim())
    .map((p) => parseEmail(p).fromEmail)
    .filter(Boolean);
}

function parseEmail(s) {
  if (!s) return { fromEmail: null, fromName: null };
  const m = String(s).match(/^(.*)<([^>]+)>\s*$/);
  if (m) return { fromName: m[1].trim().replace(/^\"|\"$/g, '') || null, fromEmail: m[2].trim() };
  // fallback: raw email
  const email = String(s).trim();
  return { fromName: null, fromEmail: email.includes('@') ? email : null };
}

function stableInteractionId(kind, primaryId, email) {
  return crypto.createHash('sha256').update(`${kind}:${primaryId}:${email}`).digest('hex').slice(0, 24);
}

function toIso(s) {
  if (!s) return new Date().toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
