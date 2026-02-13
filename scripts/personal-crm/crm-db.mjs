import fs from 'node:fs';
import { dbPath, dbRoot } from '../lib/db.mjs';
import { loadEnvLocal } from '../lib/env.mjs';
import { openSqlite } from '../lib/sqlite.mjs';

export function openCrmDb({ readonly = false } = {}) {
  loadEnvLocal();
  fs.mkdirSync(dbRoot(), { recursive: true });
  const path = dbPath('personal-crm.sqlite');
  const db = openSqlite(path, { readonly });

  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      email TEXT PRIMARY KEY,
      name TEXT,
      first_seen_at TEXT,
      last_seen_at TEXT,
      last_subject TEXT,
      last_snippet TEXT,
      source_counts_json TEXT
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      contact_email TEXT NOT NULL,
      kind TEXT NOT NULL, -- 'gmail' | 'calendar'
      ts TEXT NOT NULL,
      subject TEXT,
      snippet TEXT,
      message_id TEXT,
      thread_id TEXT,
      event_id TEXT,
      raw_json TEXT,
      FOREIGN KEY(contact_email) REFERENCES contacts(email)
    );

    CREATE INDEX IF NOT EXISTS idx_interactions_contact_ts
      ON interactions(contact_email, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_interactions_ts
      ON interactions(ts DESC);
  `);

  return { db, path };
}

export function upsertContactFromInteraction(db, {
  email,
  name,
  ts,
  subject,
  snippet,
  source,
} = {}) {
  if (!email) return;

  const row = db.prepare('SELECT * FROM contacts WHERE email = ?').get(email);
  const sourceCounts = row?.source_counts_json ? safeJson(row.source_counts_json, {}) : {};
  sourceCounts[source] = (sourceCounts[source] || 0) + 1;

  const firstSeen = row?.first_seen_at || ts;
  const lastSeen = row?.last_seen_at && row.last_seen_at > ts ? row.last_seen_at : ts;

  const lastSubject = subject || row?.last_subject || null;
  const lastSnippet = snippet || row?.last_snippet || null;

  db.prepare(`
    INSERT INTO contacts (email, name, first_seen_at, last_seen_at, last_subject, last_snippet, source_counts_json)
    VALUES (@email, @name, @first_seen_at, @last_seen_at, @last_subject, @last_snippet, @source_counts_json)
    ON CONFLICT(email) DO UPDATE SET
      name = COALESCE(excluded.name, contacts.name),
      first_seen_at = MIN(contacts.first_seen_at, excluded.first_seen_at),
      last_seen_at = MAX(contacts.last_seen_at, excluded.last_seen_at),
      last_subject = excluded.last_subject,
      last_snippet = excluded.last_snippet,
      source_counts_json = excluded.source_counts_json
  `).run({
    email,
    name: name || null,
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    last_subject: lastSubject,
    last_snippet: lastSnippet,
    source_counts_json: JSON.stringify(sourceCounts),
  });
}

function safeJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
