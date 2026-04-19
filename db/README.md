# db/

This repo directory tracks schema/migration sources for local SQLite databases.

Databases are stored in the local Google Drive sync folder for durability:

`~/Library/CloudStorage/GoogleDrive-richducat@gmail.com/My Drive/OpenClaw Databases/`

Scripts should use that location (via env var `OPENCLAW_DB_ROOT`), not commit DB files to git.

## Hybrid DB standard (roadmap item #2)

Canonical DB file:
- `hybrid-core.sqlite`

Migrations:
- `db/migrations/*.sql` (ordered by filename)
- Applied migration records are stored in the DB table `schema_migrations`.

Bootstrap command:
```bash
npm run db:hybrid:init
```

This command:
- Creates the DB directory if needed.
- Opens/creates `hybrid-core.sqlite`.
- Applies unapplied migration files transactionally.
- Enforces checksum consistency for previously-applied migrations.

Current baseline schema includes:
- `entities` for canonical CRM/KB/Ops records
- `entity_chunks` for chunked text and embedding vectors (stored as JSON arrays)
- `entity_links` for typed relations between entities
- `ingestion_cursors` for incremental source checkpointing

## Roadmap item #3: Gmail + Calendar daily ingestion

Ingestion command:
```bash
npm run db:hybrid:ingest
```

Optional flags:
- `--account <email>`: account identity for source lookups and self-filtering
- `--days <n>`: backfill window when no cursor exists (default `1`)
- `--max <n>`: max Gmail messages to fetch when using live `gog`
- `--calendarId <id>`: calendar source id (default `primary`)
- `--gmail-json <path>`: ingest from JSON fixture/file instead of live `gog`
- `--calendar-json <path>`: ingest from JSON fixture/file instead of live `gog`

Fixture validation example:
```bash
npm run db:hybrid:ingest -- \
  --gmail-json scripts/db/fixtures/gmail-sample.json \
  --calendar-json scripts/db/fixtures/calendar-sample.json \
  --account richducat@gmail.com
```

Design notes:
- Source records are mapped into `entities` (`gmail_message`, `calendar_event`, `contact`).
- Retrieval text is stored in `entity_chunks` (chunk `0` for each entity).
- Contact relations are stored in `entity_links` (`gmail_counterparty`, `calendar_attendee`).
- `ingestion_cursors` tracks latest ingestion timestamp per source for incremental reruns.

## Roadmap item #4: Knowledge base ingestion (URLs + files)

Ingestion command:
```bash
npm run db:hybrid:ingest:kb -- --from-file scripts/db/fixtures/kb-sources-sample.json
```

Alternative explicit source flags:
```bash
npm run db:hybrid:ingest:kb -- \
  --file docs/reference/openclaw-docs-home.md \
  --url https://example.com/
```

Optional flags:
- `--from-file <path>`: source list input (`.json` with `{ files, urls }`, or newline text list)
- `--file <path>`: local file source (repeatable)
- `--url <https://...>`: URL source (repeatable)
- `--max-chars <n>`: chunk size (default `1200`)
- `--overlap-chars <n>`: overlap between adjacent chunks (default `120`)
- `--embed`: generate chunk embeddings via OpenAI API (requires `OPENAI_API_KEY`)
- `--embedding-model <name>`: embedding model when `--embed` is set (default `text-embedding-3-small`)

Design notes:
- Sources are mapped into `entities` with:
  - `domain = kb`
  - `type = kb_source`
  - deterministic `id` from canonical source reference (`file:<abs-path>` / `url:<normalized-url>`)
- Source metadata includes deterministic content hash (`content_sha256`) and traceability fields (`source_path` / `source_url`).
- Re-runs are change-safe:
  - unchanged content hash is skipped
  - changed content re-upserts entity + deterministic chunk indexes
  - stale trailing chunks are deleted when chunk count shrinks
- The ingestion checkpoint is tracked in `ingestion_cursors` under source key `kb_ingest`.
