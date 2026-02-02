import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env.local loader (no external deps).
 *
 * - ignores blank lines and comments
 * - supports KEY=VALUE (no export)
 * - does not support multiline or quotes (good enough for our usage)
 */
export function loadEnvLocal(file = path.resolve('.env.local')) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key) continue;
    if (process.env[key] == null) process.env[key] = value;
  }
}
