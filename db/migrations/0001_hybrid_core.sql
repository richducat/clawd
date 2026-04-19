PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL CHECK (domain IN ('crm', 'kb', 'ops', 'mixed')),
  type TEXT NOT NULL,
  external_ref TEXT,
  title TEXT,
  body TEXT,
  metadata_json TEXT,
  source_system TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_source_ref_uniq
  ON entities(source_system, external_ref)
  WHERE source_system IS NOT NULL AND external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entities_domain_type
  ON entities(domain, type);

CREATE INDEX IF NOT EXISTS idx_entities_updated_at
  ON entities(updated_at DESC);

CREATE TABLE IF NOT EXISTS entity_chunks (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER,
  embedding_model TEXT,
  embedding_dim INTEGER,
  embedding_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  UNIQUE(entity_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_entity_chunks_entity
  ON entity_chunks(entity_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_entity_chunks_embedding_model
  ON entity_chunks(embedding_model);

CREATE TABLE IF NOT EXISTS entity_links (
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(from_entity_id, to_entity_id, relation_type),
  FOREIGN KEY(from_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY(to_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS idx_entity_links_to
  ON entity_links(to_entity_id, relation_type);
