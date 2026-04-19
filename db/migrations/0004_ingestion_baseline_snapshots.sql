CREATE TABLE IF NOT EXISTS ingestion_baseline_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  health_run_at TEXT NOT NULL,
  current_run_id TEXT,
  current_run_completed_at TEXT,
  sample_runs INTEGER NOT NULL DEFAULT 0,
  records_actual REAL,
  records_floor REAL,
  records_ceiling REAL,
  entities_actual REAL,
  entities_floor REAL,
  entities_ceiling REAL,
  links_actual REAL,
  links_floor REAL,
  links_ceiling REAL,
  anomaly_count INTEGER NOT NULL DEFAULT 0,
  anomalies_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, health_run_at)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_baseline_snapshots_source_run
  ON ingestion_baseline_snapshots(source, health_run_at DESC);
