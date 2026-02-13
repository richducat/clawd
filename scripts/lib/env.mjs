import fs from 'node:fs';
import path from 'node:path';

// Very small .env loader (avoids adding dotenv dependency).
// Loads repo-root .env.local if present.
export function loadEnvLocal() {
  const p = path.resolve('.env.local');
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Don't overwrite existing env.
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
