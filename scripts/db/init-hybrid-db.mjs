import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { dbPath, ensureDbDir } from '../lib/db.mjs';
import { loadEnvLocal } from '../lib/env.mjs';
import { openSqlite } from '../lib/sqlite.mjs';

async function main() {
  loadEnvLocal();
  await ensureDbDir();

  const targetPath = dbPath('hybrid-core.sqlite');
  const migrationsDir = path.resolve('db/migrations');
  const db = openSqlite(targetPath);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum_sha256 TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const files = (await fs.readdir(migrationsDir))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();

    if (files.length === 0) {
      console.log(`No migration files found in ${migrationsDir}`);
      return;
    }

    let appliedCount = 0;
    let skippedCount = 0;

    for (const filename of files) {
      const fullPath = path.join(migrationsDir, filename);
      const sql = await fs.readFile(fullPath, 'utf8');
      const checksum = sha256(sql);
      const existing = db.prepare('SELECT checksum_sha256 FROM schema_migrations WHERE filename = ?').get(filename);

      if (existing) {
        if (existing.checksum_sha256 !== checksum) {
          throw new Error(
            `Migration checksum mismatch for ${filename}. Existing=${existing.checksum_sha256} New=${checksum}`,
          );
        }
        skippedCount += 1;
        continue;
      }

      const tx = db.transaction(() => {
        db.exec(sql);
        db.prepare(
          'INSERT INTO schema_migrations (filename, checksum_sha256) VALUES (?, ?)',
        ).run(filename, checksum);
      });

      tx();
      appliedCount += 1;
      console.log(`Applied migration: ${filename}`);
    }

    const summary = db
      .prepare('SELECT COUNT(*) AS n FROM schema_migrations')
      .get();

    console.log(`Hybrid DB ready: ${targetPath}`);
    console.log(`Migrations applied this run: ${appliedCount}`);
    console.log(`Migrations skipped this run: ${skippedCount}`);
    console.log(`Total applied migrations: ${summary.n}`);
  } finally {
    db.close();
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
