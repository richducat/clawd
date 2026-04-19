CREATE TABLE IF NOT EXISTS ingestion_run_metrics (
  run_id TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'partial_failure', 'failed')),
  run_started_at TEXT NOT NULL,
  run_completed_at TEXT NOT NULL,
  records_scanned INTEGER NOT NULL DEFAULT 0,
  entities_upserted INTEGER NOT NULL DEFAULT 0,
  chunks_upserted INTEGER NOT NULL DEFAULT 0,
  links_upserted INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metrics_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, source)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_run_metrics_source_completed
  ON ingestion_run_metrics(source, run_completed_at DESC);
