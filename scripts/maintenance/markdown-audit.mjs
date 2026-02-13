#!/usr/bin/env node
/**
 * Daily markdown audit (lightweight)
 *
 * Goal: catch drift and missing basics.
 * - Confirms key workspace files exist
 * - Flags obvious policy conflicts (email send policy)
 * - Reminds about known failure modes (RingCentral, backups)
 *
 * Output is plain text for Telegram.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const mustExist = [
  'workspace.md',
  'MEMORY.md',
  'SOUL.md',
  'USER.md',
  'AGENTS.md',
  'HEARTBEAT.md',
];

async function exists(p) {
  try {
    await fs.access(path.join(ROOT, p));
    return true;
  } catch {
    return false;
  }
}

async function readText(p) {
  return fs.readFile(path.join(ROOT, p), 'utf8');
}

function has(text, needle) {
  return text.toLowerCase().includes(String(needle).toLowerCase());
}

(async function main() {
  const missing = [];
  for (const f of mustExist) {
    if (!(await exists(f))) missing.push(f);
  }

  const lines = [];
  lines.push(`Markdown audit — ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);

  if (missing.length) {
    lines.push('Missing files:');
    for (const f of missing) lines.push(`- ${f}`);
  } else {
    lines.push('Core workspace markdown files: OK');
  }

  // Policy consistency checks
  const mem = (await exists('MEMORY.md')) ? await readText('MEMORY.md') : '';
  const dailyPath = `memory/${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}.md`;
  const daily = (await exists(dailyPath)) ? await readText(dailyPath) : '';

  // Email policy
  const wantsDraftFirst = has(mem, 'draft-first') || has(daily, 'draft-first');
  const mentionsAutoSend = has(mem, 'auto-send') || has(daily, 'auto-send');

  if (!wantsDraftFirst) {
    lines.push('Email policy: WARNING — draft-first not found in MEMORY/daily.');
  } else {
    lines.push('Email policy: draft-first mode is recorded.');
  }

  if (wantsDraftFirst && mentionsAutoSend) {
    lines.push('Email policy: NOTE — both "auto-send" and "draft-first" appear in memory; ensure draft-first is the active rule.');
  }

  // RingCentral known issue reminder
  lines.push('RC: If SMS jobs are failing with invalid_grant, re-auth per-user refresh tokens (new tenant).');

  // Backup reminder
  lines.push('Backups: hourly git sync + nightly Drive bundle should be green (check if any repo branch lacks upstream).');

  process.stdout.write(lines.join('\n') + '\n');
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
