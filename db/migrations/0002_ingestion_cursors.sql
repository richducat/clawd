CREATE TABLE IF NOT EXISTS ingestion_cursors (
  source TEXT PRIMARY KEY,
  cursor_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ingestion_cursors_updated_at
  ON ingestion_cursors(updated_at DESC);
