CREATE TABLE IF NOT EXISTS meeting_prep_attendee_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_email TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  event_id TEXT NOT NULL,
  attendee_email TEXT NOT NULL,
  attendee_name TEXT,
  risk_level TEXT NOT NULL,
  risk_rank INTEGER NOT NULL,
  confidence_score INTEGER NOT NULL,
  touchpoints7d INTEGER NOT NULL DEFAULT 0,
  touchpoints30d INTEGER NOT NULL DEFAULT 0,
  touchpoints90d INTEGER NOT NULL DEFAULT 0,
  response_status TEXT,
  last_touch_at TEXT,
  snapshot_json TEXT,
  run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS meeting_prep_snapshots_lookup_idx
  ON meeting_prep_attendee_snapshots (account_email, event_id, attendee_email, run_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS meeting_prep_snapshots_day_idx
  ON meeting_prep_attendee_snapshots (meeting_date, run_at DESC);
