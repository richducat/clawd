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
- `--allow-partial-sources`: continue ingest when exactly one live source fails (records partial failure details in JSON output)
- `--connector-retries <n>`: retry attempts for each live `gog` call (default `2`)
- `--connector-backoff-ms <n>`: initial retry backoff in ms for live `gog` calls (default `800`)
- `--connector-backoff-factor <n>`: retry backoff multiplier (default `2`)

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
- Cursor updates are source-scoped: failed sources do not advance their cursor checkpoint.

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

## Roadmap item #5: Daily meeting prep brief (hybrid CRM)

Brief command:
```bash
npm run db:hybrid:meeting-prep -- --date 2026-04-18 --account richducat@gmail.com
```

Optional flags:
- `--date <YYYY-MM-DD>`: target local day (default `today`)
- `--account <email>`: owner identity used to exclude self from attendee lists
- `--limit <n>`: max external meetings in output (default `50`)
- `--internal-domain <domain>`: additional internal domains to exclude (repeatable)
- `--json`: emit machine-readable JSON instead of markdown text

Output behavior:
- Reads `calendar_event` + `contact` + `gmail_message` entities from `hybrid-core.sqlite`.
- Includes only meetings on the target date with at least one external attendee.
- Excludes internal-only attendees using account email + internal domain filters.
- For each external attendee, includes latest ingested Gmail touchpoint when available.

## Follow-up: one-command daily hybrid pipeline

Orchestrator command:
```bash
npm run db:hybrid:daily -- \
  --account richducat@gmail.com \
  --date 2026-04-19 \
  --gmail-json scripts/db/fixtures/gmail-sample.json \
  --calendar-json scripts/db/fixtures/calendar-sample.json \
  --kb-from-file scripts/db/fixtures/kb-sources-sample.json \
  --brief-out memory/meeting-prep-2026-04-19.md
```

What it runs (in order):
- `db:hybrid:init`
- `db:hybrid:ingest`
- optional `db:hybrid:ingest:kb` (when KB sources are provided and `--skip-kb` is not set)
- `db:hybrid:meeting-prep`

Optional flags:
- CRM ingest passthrough:
  - `--account`, `--days`, `--max`, `--calendarId`
  - `--gmail-json`, `--calendar-json`
  - `--allow-partial-sources`
  - `--connector-retries`, `--connector-backoff-ms`, `--connector-backoff-factor`
- KB ingest passthrough:
  - `--kb-from-file`
  - `--kb-file` (repeatable)
  - `--kb-url` (repeatable)
  - `--kb-max-chars`, `--kb-overlap-chars`
  - `--kb-embed`, `--kb-embedding-model`
  - `--skip-kb` to skip KB step explicitly
- Brief output passthrough:
  - `--date`
  - `--internal-domain` (repeatable)
  - `--brief-json`
  - `--brief-out <path>` to write meeting prep output to file

Output behavior:
- The orchestrator always emits a JSON summary with per-step status:
  - `ok`
  - `partial_failure`
  - `failed`
- Pipeline exits non-zero only when a step is `failed`.
- Partial source outages in CRM ingest are surfaced in summary details when `--allow-partial-sources` is enabled.

## Scheduled daily run + artifacts (GitHub Actions)

Workflow:
- `.github/workflows/hybrid-daily-pipeline.yml`

Triggers:
- daily schedule (`13:20 UTC`)
- manual run (`workflow_dispatch`) with inputs:
  - `account`
  - `date`
  - `use_fixtures`
  - `skip_kb`
  - `max_lag_hours`
  - `max_seen_drift_hours`
  - `max_artifact_issues`

Artifacts:
- `meeting-prep-YYYY-MM-DD.md`
- `pipeline-summary-YYYY-MM-DD.json`
- `ingestion-health-YYYY-MM-DD.md`
- `ingestion-health-YYYY-MM-DD.json`
- uploaded as workflow artifact `hybrid-daily-YYYY-MM-DD` with `retention-days: 14`

Runtime notes:
- CI sets `OPENCLAW_DB_ROOT` to a workspace-local temp directory so no DB files are committed.
- Default mode uses repository fixtures for deterministic scheduled checks.
- To run against live connector data, use a self-hosted runner environment where the live source prerequisites are available and set `use_fixtures=false` on manual dispatch.
- The workflow runs `db:hybrid:health` after the daily pipeline:
  - markdown report mode (artifact-only)
  - threshold-gated JSON mode with defaults:
    - `--max-lag-hours 24`
    - `--max-seen-drift-hours 48`
    - `--max-artifact-issues 0`
- Threshold breaches return exit code `2`, causing the workflow job to fail while still uploading artifacts via `if: always()`.
- Optional breach alerting:
  - configure repo secret `HYBRID_ALERT_WEBHOOK_URL`
  - when set, a failing health gate posts a JSON payload (`text` field) containing run URL, run date, threshold settings, and artifact label
  - when unset, the workflow logs a warning and skips outbound notification

## Retrieval/query layer (roadmap tranche option #2)

Query command:
```bash
npm run db:hybrid:query -- --query "appointment scheduling"
```

Optional flags:
- `--query <text>`: required plain-text query
- `--limit <n>`: max ranked matches (default `10`, max `100`)
- `--domain <crm|kb|ops|mixed>`: filter by domain (repeatable)
- `--type <entity_type>`: filter by entity type (repeatable)
- `--json`: emit machine-readable JSON output

Ranking + output notes:
- Deterministic lexical ranking is used so results are stable even when embedding vectors are absent.
- Scores weight title hits, chunk hits, and query token coverage.
- Results include traceability fields:
  - `entity_id`
  - `external_ref`
  - `chunk_index`
  - `snippet`

## Ops dashboard: ingestion health + cursor drift (roadmap tranche option #3)

Health command:
```bash
npm run db:hybrid:health
```

JSON mode for automation:
```bash
npm run db:hybrid:health -- --json
```

Optional flags:
- `--as-of <iso>`: evaluate lag/drift against a fixed timestamp (default `now`)
- `--artifact-dir <path>`: scan pipeline summary artifacts for failure signals (default `artifacts`)
- `--artifacts-max <n>`: max recent `pipeline-summary-*.json` files to inspect (default `8`)
- threshold guards (optional, non-zero exit when breached):
  - `--max-lag-hours <n>`
  - `--max-seen-drift-hours <n>`
  - `--max-artifact-issues <n>`

Threshold-gated example (CI/alerts):
```bash
npm run db:hybrid:health -- \
  --json \
  --max-lag-hours 24 \
  --max-seen-drift-hours 48 \
  --max-artifact-issues 0
```

Exit behavior:
- Default/report-only mode (no threshold flags): exits `0`.
- Threshold mode (one or more threshold flags): exits `2` when any configured threshold is breached.

Output includes:
- source health rows for `gmail`, `google_calendar`, `kb_ingest`:
  - status (`healthy` / `stale` / `critical` / `missing`)
  - `lag_hours` from `last_ingested_at`
  - `seen_drift_hours` from `latest_seen_at` when available
- entity/chunk coverage totals and counts grouped by `domain/type`
- recent entity update snapshots
- recent failure/error signals inferred from pipeline summary artifacts when present
- threshold metadata (`thresholds`) and explicit breach records (`breaches`)
