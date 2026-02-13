#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { loadEnvLocal } from '../lib/env.mjs';

loadEnvLocal();
import { openCrmDb } from './crm-db.mjs';

// Meeting prep (v1):
// - Pull today's calendar events
// - Filter events with external attendees
// - For each attendee, show last touch from CRM DB

const args = process.argv.slice(2);
const account = getArg(args, '--account') || process.env.GOG_ACCOUNT || 'richducat@gmail.com';
const calendarId = getArg(args, '--calendarId') || 'primary';

const todayStart = new Date();
todayStart.setHours(0, 0, 0, 0);
const todayEnd = new Date();
todayEnd.setHours(23, 59, 59, 999);

const events = gogJson(['calendar', 'events', calendarId, '--from', todayStart.toISOString(), '--to', todayEnd.toISOString(), '--account', account, '--json']);
const items = events?.events || events?.items || events || [];

const { db } = openCrmDb({ readonly: true });

const lastTouchStmt = db.prepare(`
  SELECT ts, subject, snippet, kind
  FROM interactions
  WHERE contact_email = ?
  ORDER BY ts DESC
  LIMIT 1
`);

const me = account.toLowerCase();

const blocks = [];
for (const ev of Array.isArray(items) ? items : []) {
  const summary = (ev.summary || ev.title || '(no title)').trim();
  const start = ev.start?.dateTime || ev.start?.date || ev.start;
  const startIso = start ? new Date(start).toISOString() : null;

  const attendees = (ev.attendees || []).map((a) => a.email).filter(Boolean);
  const external = attendees.filter((e) => e.toLowerCase() !== me);
  if (external.length === 0) continue;

  // skip internal-only (heuristic: everyone is @thankyouforyourservice.co or your own)
  const nonInternal = external.filter((e) => !e.toLowerCase().endsWith('@thankyouforyourservice.co'));
  if (nonInternal.length === 0) continue;

  const lines = [];
  lines.push(`- ${startIso ? startIso.slice(11, 16) : '??:??'} — ${summary}`);

  for (const email of nonInternal) {
    const lt = lastTouchStmt.get(email);
    if (lt) {
      lines.push(`  - ${email}: last touch ${lt.ts.slice(0, 10)} via ${lt.kind} — ${clean(lt.subject)}${lt.snippet ? ` (${clean(lt.snippet)})` : ''}`);
    } else {
      lines.push(`  - ${email}: no CRM history yet (new contact)`);
    }
  }

  blocks.push(lines.join('\n'));
}

if (blocks.length === 0) {
  console.log('No external meetings detected for today.');
} else {
  console.log(`Meeting prep for today (${todayStart.toISOString().slice(0, 10)}):\n\n${blocks.join('\n\n')}`);
}

function gogJson(cmd) {
  const out = execFileSync('gog', cmd, { encoding: 'utf8' });
  return JSON.parse(out);
}

function getArg(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || null;
}

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}
