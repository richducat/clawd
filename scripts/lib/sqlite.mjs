import Database from 'better-sqlite3';

export function openSqlite(path, { readonly = false } = {}) {
  const db = new Database(path, { readonly });
  // Safer defaults for concurrent cron-ish usage.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}
