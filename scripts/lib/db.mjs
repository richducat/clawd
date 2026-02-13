import fs from 'node:fs/promises';
import path from 'node:path';

// Single source of truth for persistent DB storage.
// Default: local Google Drive sync folder (set in .env.local as OPENCLAW_DB_ROOT).
export function dbRoot() {
  return process.env.OPENCLAW_DB_ROOT
    ? String(process.env.OPENCLAW_DB_ROOT)
    : path.resolve('db');
}

export function dbPath(name) {
  if (!name) throw new Error('dbPath: missing name');
  const file = name.endsWith('.sqlite') ? name : `${name}.sqlite`;
  return path.join(dbRoot(), file);
}

export async function ensureDbDir() {
  await fs.mkdir(dbRoot(), { recursive: true });
}
