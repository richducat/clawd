import fs from 'node:fs/promises';
import path from 'node:path';

// Single source of truth for persistent DB storage.
// Default: local Google Drive sync folder (set in .env.local as OPENCLAW_DB_ROOT).
export function dbRoot() {
  if (!process.env.OPENCLAW_DB_ROOT) return path.resolve('db');
  let p = String(process.env.OPENCLAW_DB_ROOT);
  // Expand $HOME and unescape common shell escapes (\ ).
  if (p.includes('$HOME')) p = p.replaceAll('$HOME', process.env.HOME || '');
  p = p.replace(/\\ /g, ' ');
  return p;
}

export function dbPath(name) {
  if (!name) throw new Error('dbPath: missing name');
  const file = name.endsWith('.sqlite') ? name : `${name}.sqlite`;
  return path.join(dbRoot(), file);
}

export async function ensureDbDir() {
  await fs.mkdir(dbRoot(), { recursive: true });
}
