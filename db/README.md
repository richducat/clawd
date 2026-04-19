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
- `ingestion_run_metrics` for per-source run counters and reconciliation checks
- `ingestion_baseline_snapshots` for persisted baseline bands/anomaly snapshots used by long-range trend reporting
- `meeting_prep_attendee_snapshots` for run-to-run attendee relationship risk/confidence deltas in meeting-prep output

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
- For each external attendee, includes:
  - latest ingested Gmail touchpoint when available
  - relationship history snapshot (`touchpoints7d`, `touchpoints30d`, `touchpoints90d`, recent subjects)
  - attendee-level relationship risk assessment (`low`/`medium`/`high`) with deterministic risk signals
  - attendee confidence scoring (`score`, `level`, rationale)
  - attendee role profile inference (`decision partner`, `active collaborator`, `new stakeholder`, `at-risk stakeholder`, `blocked stakeholder`, `observer`) with deterministic evidence signals
  - attendee-level stakeholder intent summary (`intent`, `approach`, `priority`, `confidence`, `signals`)
  - relationship-risk deltas versus prior runs (`improved` / `declined` / `unchanged` / `new`)
  - deterministic recommended next actions inferred from touchpoint recency and response status
- For each meeting, also includes:
  - role-aware prep brief items with explicit priority (`high`/`medium`/`low`)
  - agenda-gap detection signals (`code`, `severity`, `message`, `recommendation`) derived from attendee role mix + risk signals
  - deterministic talking-point sequence (`order`, `priority`, `objective`, `prompt`, `drivers`)
  - objection-rebuttal packs for medium/high-risk or unstable attendees (`objection`, `rebuttal`, `evidence`, `nextAsk`)
  - stakeholder intent rollup for all attendees (`attendee`, `intent`, `approach`, `priority`, `confidence`)
  - negotiation fallback prompt packs (`trigger`, `prompt`, `desiredOutcome`, `priority`, `drivers`) for deterministic resistance handling
  - commitment closeout checklist (`check`, `priority`, `why`, `ownerHint`) to enforce owner/date closure discipline
  - follow-up draft pack (`subject`, `sendBy`, `summary`, `asks`, `recipientsHint`, `messageLines`) for deterministic post-meeting outbound
  - commitment risk aging model (`summary`, `windows`) with deterministic 24h/72h/7d windows for post-meeting risk carryover
  - owner escalation prompt pack (`trigger`, `prompt`, `desiredOutcome`, `priority`, `ownerHint`) for deterministic ownership escalation follow-through
  - stakeholder-ready narrative pack (`headline`, `opening`, `middle`, `close`, `proofPoints`, `topDependencies`) for concise executive-ready meeting storytelling
  - dependency-aware follow-through prompts (`trigger`, `prompt`, `desiredOutcome`, `priority`, `ownerHint`, `dependsOn`) for deterministic dependency closure after the meeting
  - decision-commitment sequencing model (`summary`, `steps`) for deterministic decision-order and owner/date lock sequencing
  - stakeholder-specific close scripts (`attendee`, `trigger`, `script`, `desiredOutcome`, `priority`) for deterministic stakeholder closeout messaging
  - failure-mode rehearsals (`trigger`, `rehearsalQuestion`, `mitigationPath`, `ownerHint`, `evidenceToCapture`, `priority`, `dependsOn`) for deterministic contingency handling when commitments slip
  - stakeholder proof-request pack (`attendee`, `request`, `rationale`, `dueWindow`, `priority`, `dependsOn`) for explicit post-meeting proof capture
  - meeting-prep quality scoring (`score`, `level`, `gapCount`, `summary`, `coverageChecks`) for deterministic output-completeness assessment
  - deterministic meeting-level recommendations derived from cross-attendee risk patterns, each with confidence metadata
  - cross-attendee relationship risk signals (`code`, `severity`, `count`, `attendees`, `message`)
  - meeting-level risk delta summary versus prior runs

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
  - `live_mode`
  - `break_glass`
  - `break_glass_reason`
  - `skip_kb`
  - `max_lag_hours`
  - `max_seen_drift_hours`
  - `max_artifact_issues`
  - `max_drift_signals` (optional live drift gate; blank = report-only)
  - `max_drift_severity_score` (optional weighted live drift gate; blank = report-only)
  - `incident_age_warning_minutes` (optional alert override; blank = repo variable/default)
  - `incident_age_critical_minutes` (optional alert override; blank = repo variable/default)

Artifacts:
- `meeting-prep-YYYY-MM-DD.md`
- `pipeline-summary-YYYY-MM-DD.json`
- `ingestion-health-YYYY-MM-DD.md`
- `ingestion-health-YYYY-MM-DD.json`
- `ingestion-trends-<UTCSTAMP>.md`
- `ingestion-trends-<UTCSTAMP>.json`
- live lane only:
  - `live-incident-ledger-YYYY-MM-DD-run-<run_id>-attempt-<run_attempt>.json`
  - `live-incident-ledger-YYYY-MM-DD-run-<run_id>-attempt-<run_attempt>.md`
  - `canary-live-drift-YYYY-MM-DD.json`
  - `canary-live-drift-YYYY-MM-DD.md`
- uploaded as workflow artifact with lane-specific name:
  - `hybrid-daily-canary-YYYY-MM-DD`
  - `hybrid-daily-live-YYYY-MM-DD`
  (both use `retention-days: 14`)

Runtime notes:
- CI sets `OPENCLAW_DB_ROOT` to a workspace-local temp directory so no DB files are committed.
- Canary lane (`schedule`, or manual with `live_mode=false`) runs on `ubuntu-latest`.
- Live lane (manual with `live_mode=true`) runs on `self-hosted`.
- Default scheduled behavior uses repository fixtures for deterministic checks.
- Live governance policy (enforced before preflight/pipeline):
  - live job binds to protected GitHub Environment `hybrid-live`
  - live dispatch is restricted to `main` branch
  - live dispatch rejects `use_fixtures=true`
  - triggering actor must be present in repo variable `HYBRID_LIVE_ALLOWED_ACTORS` (comma-separated usernames; defaults to `richducat` when unset)
  - repo variable `HYBRID_LIVE_EMERGENCY_STOP=true` blocks live execution unless manual dispatch sets `break_glass=true`
  - when `break_glass=true`, `break_glass_reason` must be non-empty; workflow logs actor + emergency-stop state + reason as a live audit line
- Recommended setup:
  - configure required reviewers for Environment `hybrid-live`
  - maintain `HYBRID_LIVE_ALLOWED_ACTORS` for approved live operators
  - use `HYBRID_LIVE_EMERGENCY_STOP=true` during incidents/maintenance windows to freeze live runs
- Live lane enforces preflight checks before the pipeline starts:
  - `gog` is installed on the runner
  - Gmail probe succeeds for the selected account
  - Calendar probe succeeds for the selected account
- The workflow runs `db:hybrid:health` after the daily pipeline:
  - markdown report mode (artifact-only)
  - threshold-gated JSON mode with defaults:
    - `--trend-artifact-dir artifacts`
    - `--trend-artifact-prefix ingestion-trends`
    - `--trend-retention-count 180`
    - `--max-lag-hours 24`
    - `--max-seen-drift-hours 48`
    - `--max-artifact-issues 0`
    - `--max-slo-budget-burn-pct 100`
    - optional quality-drift guards:
      - `--max-quality-drift-signals <n>`
      - `--max-quality-severity-score <n>`
  - `--max-quality-readiness-drop <n>`
  - `--min-quality-narrative-coverage-pct <n>`
  - `--min-quality-dependency-coverage-pct <n>`
  - `--min-quality-decision-sequencing-coverage-pct <n>`
  - `--min-quality-close-scripts-coverage-pct <n>`
  - `--min-quality-failure-mode-rehearsal-coverage-pct <n>`
  - `--min-quality-stakeholder-proof-request-coverage-pct <n>`
  - `--min-quality-decision-sequencing-coverage-pct <n>`
  - `--min-quality-close-scripts-coverage-pct <n>`
- Threshold breaches return exit code `2`, causing the workflow job to fail while still uploading artifacts via `if: always()`.
- Live lane also runs canary-vs-live drift comparison after health report generation:
  - resolves latest same-date canary artifact (`hybrid-daily-canary-YYYY-MM-DD`) via GitHub Actions artifact API
  - runs `npm run db:hybrid:drift -- --live-json ... [--canary-json ...]`
  - emits deterministic drift evidence artifacts (`canary-live-drift-YYYY-MM-DD.{json,md}`)
  - if canary baseline is unavailable, drift report is emitted as `status=baseline_unavailable` (non-failing report path)
  - if `max_drift_signals` workflow input is set, drift step exits `2` when signal count exceeds that threshold
  - if `max_drift_severity_score` workflow input is set, drift step exits `2` when severity-weight total exceeds that threshold
  - drift signals include deterministic taxonomy fields (`category`, `severity_weight`) plus rollups (`severity_counts`, `category_counts`, `total_severity_score`)
- Optional breach alerting:
  - base route config:
    - `HYBRID_ALERT_WEBHOOK_URL` (single route)
    - `HYBRID_ALERT_WEBHOOK_URLS` (comma/newline multi-route fan-out)
  - optional drift-incident route config (used when drift signals exist):
    - `HYBRID_ALERT_DRIFT_WEBHOOK_URL`
    - `HYBRID_ALERT_DRIFT_WEBHOOK_URLS`
  - optional quality-drift route config (used when meeting-prep quality drift signals exist):
    - `HYBRID_ALERT_QUALITY_WEBHOOK_URL`
    - `HYBRID_ALERT_QUALITY_WEBHOOK_URLS`
  - optional escalation route config:
    - `HYBRID_ALERT_ESCALATION_WEBHOOK_URL`
    - `HYBRID_ALERT_ESCALATION_WEBHOOK_URLS`
  - optional drift-escalation route config:
    - `HYBRID_ALERT_DRIFT_ESCALATION_WEBHOOK_URL`
    - `HYBRID_ALERT_DRIFT_ESCALATION_WEBHOOK_URLS`
  - optional quality-escalation route config:
    - `HYBRID_ALERT_QUALITY_ESCALATION_WEBHOOK_URL`
    - `HYBRID_ALERT_QUALITY_ESCALATION_WEBHOOK_URLS`
    - `HYBRID_ALERT_ESCALATION_WINDOWS_ET` (repo variable, defaults to `always`)
  - optional ACK SLA override:
    - `HYBRID_ALERT_ACK_SLA_MINUTES` (repo variable; hard override for SLA minutes across all incidents)
  - optional ACK escalation policy JSON override (repo variable):
    - `HYBRID_ALERT_ACK_ESCALATION_POLICY_JSON`
    - schema:
      - `default`
      - `run_mode.<canary|live>`
      - `incident_severity.<medium|high>`
      - `incident_type.<health_gate_breach|drift_signal_detected|drift_gate_breach|quality_drift_signal_detected|quality_drift_gate_breach>`
      - `incident_age_band.<new|fresh|aging|critical>`
    - each node supports:
      - `ack_sla_minutes`
      - `ack_reminder_interval_minutes`
      - `ack_escalate_after_reminders`
      - `ack_stale_after_minutes`
  - optional incident-age thresholds (repo variables or workflow dispatch input overrides):
    - `HYBRID_ALERT_INCIDENT_AGE_WARNING_MINUTES` (default `180`)
    - `HYBRID_ALERT_INCIDENT_AGE_CRITICAL_MINUTES` (default `720`)
  - optional ACK reminder route config:
    - `HYBRID_ALERT_ACK_REMINDER_WEBHOOK_URL`
    - `HYBRID_ALERT_ACK_REMINDER_WEBHOOK_URLS`
  - optional ACK reminder escalation route config:
    - `HYBRID_ALERT_ACK_REMINDER_ESCALATION_WEBHOOK_URL`
    - `HYBRID_ALERT_ACK_REMINDER_ESCALATION_WEBHOOK_URLS`
  - optional ACK reconciliation/reminder controls (repo variables):
    - `HYBRID_ALERT_ACK_REMINDER_INTERVAL_MINUTES` (default `30`)
    - `HYBRID_ALERT_ACK_ESCALATE_AFTER_REMINDERS` (default `2`)
    - `HYBRID_ALERT_ACK_EVIDENCE_MARKERS` (comma/newline/JSON-array list of acknowledged markers)
    - `HYBRID_ALERT_ACK_EVIDENCE_KEYS` (comma/newline/JSON-array list of acknowledged incident keys)
    - `HYBRID_ALERT_ACK_EVIDENCE_STALE_AFTER_MINUTES` (default `10080`; evidence entries older than this are ignored during ingestion)
    - `HYBRID_ALERT_ACK_STALE_AFTER_MINUTES` (default `1440`; pending incidents not seen within this window are marked `stale` and removed from reminder routing)
  - optional ACK evidence ingestion directory:
    - workflow reads `artifacts/ack-evidence/*.json` on failure and merges parsed markers/keys with repo-variable evidence lists
    - accepted JSON shapes include:
      - object/array entries with `ack_marker`, `ack_key`, optional `acknowledged_at_utc`
      - object fields `ack_markers`, `ack_keys`, `acknowledgements`
  - ACK evidence ingestion emits deterministic artifacts:
    - `ack-evidence-YYYY-MM-DD.json`
    - `ack-evidence-YYYY-MM-DD.md`
  - ACK reminder digest + dispatch summary artifacts emitted on failure:
    - `ack-reminder-digest-YYYY-MM-DD-<mode>.json`
    - `ack-reminder-digest-YYYY-MM-DD-<mode>.md`
    - `dispatch-alert-summary-YYYY-MM-DD-<mode>.json`
    - failure-path upload artifact bundles:
      - `hybrid-daily-canary-ack-YYYY-MM-DD`
      - `hybrid-daily-live-ack-YYYY-MM-DD`
    - summary includes active markers/keys, stale evidence count, parse-error count, and normalized ACK contracts
  - window format (`ET`):
    - `always`
    - or semicolon-delimited entries in `daySpec@HH:MM-HH:MM`
    - examples: `mon-fri@08:00-18:00;sat@09:00-12:00`, `sun@00:00-23:59`
  - on health-gate failure, workflow dispatches one JSON payload (`text` + `metadata`) to all base routes; escalation routes are included only when current ET time is inside configured escalation windows
  - when drift signals are present (`signal_count > 0` or drift gate breached), drift routes are also included; drift escalation routes are ET-window gated like base escalation
  - when meeting-prep quality drift signals are present (`quality_signal_count > 0` or quality gate breached), quality routes are also included; quality escalation routes are ET-window gated like base escalation
  - live-mode alerts include manual-approval context and emergency control state:
    - approval required flag + environment
    - triggering actor + dispatch actor
    - emergency stop + break-glass flag/reason
    - incident-ledger artifact paths (json + markdown)
    - canary-vs-live drift summary (`status`, `signal_count`, `total_severity_score`, `gate_breached`, `gate_breached_by_signal_count`, `gate_breached_by_severity_score`)
    - canary-vs-live drift artifact paths (json + markdown)
  - alerts include deterministic ACK markers in both `text` and `metadata`:
    - `ack_key`
    - `ack_marker`
    - `ack_sla_minutes`
    - `ack_due_at_utc`
    - `ack_due_at_et`
    - `ack_policy` (`deterministic_v2`)
    - `ack_policy_applied` (ordered policy source list)
    - `ack_policy_parse_error` (non-empty only when `HYBRID_ALERT_ACK_ESCALATION_POLICY_JSON` is invalid)
    - incident-age controls:
      - `incident_age_minutes`
      - `incident_age_band` (`new|fresh|aging|critical`)
      - `incident_age_warning_minutes`
      - `incident_age_critical_minutes`
      - `incident_age_escalation_due`
      - `incident_first_seen_at_utc`
    - quality drift context:
      - `quality_drift_signal_count`
      - `quality_severity_score`
      - `quality_gate_breached`
      - `quality_top_lane`
      - `quality_top_lane_severity`
  - dispatcher persists ACK state to `ALERT_ACK_STATE_PATH` and reconciles acknowledged incidents via marker/key evidence on subsequent runs
  - unresolved ACK incidents that breach SLA emit reminder metadata (`ack_reminders_due_count`) and can fan out to reminder/escalation routes
  - stale ACK state is surfaced in metadata (`ack_stale_after_minutes`, `ack_stale_pending_count`, `ack_newly_stale_count`) and excluded from reminder routing
  - ACK evidence ingestion summary is surfaced in metadata (`ack_evidence_active_marker_count`, `ack_evidence_active_key_count`, `ack_evidence_stale_entry_count`, `ack_evidence_parse_error_count`, `ack_evidence_json`)
  - ACK evidence normalization contract is emitted in both metadata and digest:
    - `ack_evidence_contract.schema_version`
    - `ack_evidence_contract.source_path`
    - `ack_evidence_contract.source_present`
    - `ack_evidence_contract.source_valid`
    - `ack_evidence_contract.active_marker_count`
    - `ack_evidence_contract.active_key_count`
    - `ack_evidence_contract.stale_entry_count`
    - `ack_evidence_contract.parse_error_count`
  - ACK SLA/reminder contract is emitted in both metadata and digest:
    - `ack_sla_reminder_contract.schema_version`
    - `ack_sla_reminder_contract.policy_name`
    - `ack_sla_reminder_contract.policy_applied`
    - `ack_sla_reminder_contract.sla_minutes`
    - `ack_sla_reminder_contract.reminder_interval_minutes`
    - `ack_sla_reminder_contract.escalate_after_reminders`
    - `ack_sla_reminder_contract.stale_after_minutes`
    - `ack_sla_reminder_contract.ack_required`
    - `ack_sla_reminder_contract.ack_due_at_utc`
    - `ack_sla_reminder_contract.ack_due_at_et`
    - `ack_sla_reminder_contract.ack_reconciled`
    - `ack_sla_reminder_contract.ack_reconciled_at_utc`
    - `ack_sla_reminder_contract.ack_reconciliation_source`
    - `ack_sla_reminder_contract.reminders_due_count`
    - `ack_sla_reminder_contract.reminder_escalations_due_count`
    - `ack_sla_reminder_contract.stale_pending_count`
    - `ack_sla_reminder_contract.newly_stale_count`
    - `ack_sla_reminder_contract.incident_age_minutes`
    - `ack_sla_reminder_contract.incident_age_band`
    - `ack_sla_reminder_contract.incident_age_escalation_due`
  - escalation summary contract is emitted in alert metadata under `escalation_summary` with deterministic policy + route fields:
    - `policy.windows_et`, `policy.et_now`, `policy.incident_type`, `policy.incident_drift_related`, `policy.incident_quality_related`
    - `policy.incident_age_band`, `policy.incident_age_minutes`, `policy.incident_age_warning_minutes`, `policy.incident_age_critical_minutes`, `policy.incident_age_escalation_due`
    - `routes.base_configured_count`, `routes.escalation_configured_count`, `routes.drift_configured_count`, `routes.drift_escalation_configured_count`, `routes.quality_configured_count`, `routes.quality_escalation_configured_count`
    - `routes.ack_reminder_configured_count`, `routes.ack_reminder_escalation_configured_count`
    - `routes.escalation_enabled`, `routes.drift_escalation_enabled`, `routes.quality_escalation_enabled`, `routes.reminder_escalation_due_count`

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
- rolling baseline model controls:
  - `--baseline-window-runs <n>`: number of prior runs per source for baseline bands (default `14`)
  - `--baseline-min-samples <n>`: minimum prior runs required before anomaly checks are active (default `5`)
  - `--baseline-sigma-multiplier <n>`: MAD-based band width multiplier for floor/ceiling detection (default `3`)
- trend output controls:
  - `--trend-window-snapshots <n>`: number of persisted baseline snapshots to include per source in trend summaries (default `14`)
- trend artifact export + retention controls:
  - `--trend-artifact-dir <path>`: write deterministic trend audit artifacts (`.md` + `.json`) to this directory
  - `--trend-artifact-prefix <stem>`: file prefix for exported trend artifacts (default `ingestion-trends`)
  - `--trend-retention-days <n>`: prune exported trend artifact files older than `n` days (non-negative)
  - `--trend-retention-count <n>`: keep only the newest `n` exported trend snapshots (markdown+json pair)
- weekly SLO digest controls:
  - `--slo-window-days <n>`: digest window size in days for snapshot + breach rollup summaries (default `7`)
  - `--slo-digest-dir <path>`: write weekly SLO digest artifacts (`.md` + `.json`) to this directory
  - `--slo-digest-prefix <stem>`: file prefix for exported SLO digest artifacts (default `ingestion-slo-weekly`)
  - `--slo-retention-days <n>`: prune exported SLO digest files older than `n` days
  - `--slo-retention-count <n>`: keep only the newest `n` exported SLO digest snapshots (markdown+json pair)
- source-level SLO budget controls:
  - `--slo-budget-window-days <n>`: run-history window in days used for source budget tracking (default `7`)
  - `--slo-target-default-pct <n>`: default target availability percentage for all sources (default `99`)
  - `--slo-target-gmail-pct <n>`: Gmail source target availability percentage override
  - `--slo-target-google-calendar-pct <n>`: Google Calendar source target availability percentage override
  - `--slo-target-kb-ingest-pct <n>`: KB ingest source target availability percentage override
  - `--slo-partial-failure-weight <n>`: weighted error cost for `partial_failure` runs in budget burn computation (default `0.5`)
  - `--slo-seasonality-window-days <n>`: lookback days used to build source day-of-week error profiles (default `56`)
  - `--slo-seasonality-min-runs <n>`: minimum runs required for current weekday profile before fallback to median profile (default `4`)
  - `--slo-seasonality-band-multiplier <n>`: MAD band width multiplier for day-profile expected error rate bands (default `1.5`)
  - `--slo-adaptive-burn-min-multiplier <n>`: lower clamp for adaptive budget-burn multiplier (default `0.6`)
  - `--slo-adaptive-burn-max-multiplier <n>`: upper clamp for adaptive budget-burn multiplier (default `1.8`)
- threshold guards (optional, non-zero exit when breached):
  - `--max-lag-hours <n>`
  - `--max-seen-drift-hours <n>`
  - `--max-artifact-issues <n>`
  - `--max-entity-delta-pct <n>`
  - `--max-chunk-ratio-delta <n>`
  - `--max-link-delta-pct <n>`
  - `--max-baseline-anomalies <n>`
  - `--max-slo-budget-burn-pct <n>`
  - `--max-quality-drift-signals <n>`
  - `--max-quality-severity-score <n>`
  - `--max-quality-readiness-drop <n>`
  - `--min-quality-narrative-coverage-pct <n>`
  - `--min-quality-dependency-coverage-pct <n>`

Threshold-gated example (CI/alerts):
```bash
npm run db:hybrid:health -- \
  --json \
  --trend-artifact-dir artifacts/trend-audits \
  --trend-artifact-prefix ingestion-trends \
  --trend-retention-days 90 \
  --trend-retention-count 120 \
  --slo-digest-dir artifacts/slo-digests \
  --slo-digest-prefix ingestion-slo-weekly \
  --slo-window-days 7 \
  --slo-retention-count 52 \
  --slo-budget-window-days 7 \
  --slo-target-default-pct 99 \
  --slo-partial-failure-weight 0.5 \
  --slo-seasonality-window-days 56 \
  --slo-seasonality-min-runs 4 \
  --slo-seasonality-band-multiplier 1.5 \
  --slo-adaptive-burn-min-multiplier 0.6 \
  --slo-adaptive-burn-max-multiplier 1.8 \
  --max-lag-hours 24 \
  --max-seen-drift-hours 48 \
  --max-artifact-issues 0 \
  --max-slo-budget-burn-pct 100 \
  --max-quality-drift-signals 999 \
  --max-quality-severity-score 999 \
  --max-quality-readiness-drop 999 \
  --min-quality-narrative-coverage-pct 0 \
  --min-quality-dependency-coverage-pct 0 \
  --min-quality-decision-sequencing-coverage-pct 0 \
  --min-quality-close-scripts-coverage-pct 0 \
  --min-quality-failure-mode-rehearsal-coverage-pct 0 \
  --min-quality-stakeholder-proof-request-coverage-pct 0
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
- source-level reconciliation from `ingestion_run_metrics`:
  - latest vs previous run counters per source
  - entity delta + entity delta %
  - chunk-per-entity ratio drift
  - link delta + link delta %
- source-specific rolling baseline model from `ingestion_run_metrics`:
  - per-source floor/ceiling bands for `records_scanned`, `entities_upserted`, `links_upserted`
  - anomaly flags when current run is below floor or above ceiling
- baseline snapshot persistence in `ingestion_baseline_snapshots` for each health run (`source`, health run time, current metric values, floor/ceiling bands, anomaly count/details)
- source-level trend summaries from persisted baseline snapshots:
  - anomaly count direction (`up`/`down`/`flat`) versus oldest snapshot in window
  - directional deltas for `records_scanned`, `entities_upserted`, `links_upserted`
- weekly SLO digest summary from persisted baseline snapshots:
  - window coverage (`window_start`, `window_end`, `window_days`)
  - source-level anomaly-free coverage and anomaly rates
  - source-level average/latest anomaly counts
- source-level SLO budget tracking from `ingestion_run_metrics`:
  - per-source run mixes (`ok`, `partial_failure`, `failed`) in the configured budget window
  - seasonality profiles by source weekday (`utc_weekday` basis) with expected error-rate floor/ceiling bands
  - per-source weighted error rate, error budget, raw burn %, adaptive burn %, raw/adaptive burn rates, and remaining budget %
  - deterministic budget status (`within_budget`, `near_budget`, `over_budget`, `critical_over_budget`) + alert level, evaluated on adaptive burn %
- breach rollup feed for digest window:
  - scans `ingestion-trends-*.json` and `ingestion-health-*.json`
  - aggregates breach events by severity and source/top breach kinds
- threshold metadata (`thresholds`) and explicit breach records (`breaches`)
- meeting-prep quality trendline drift analysis from `artifacts/meeting-prep-quality-*.json` and `artifacts/meeting-prep-phase*.json`:
  - trendline snapshots (`avg_score`, `avg_gap_count`, failing-check severity score, `readiness_score`, `narrative_coverage_pct`, `dependency_coverage_pct`, `decision_sequencing_coverage_pct`, `close_scripts_coverage_pct`, `failure_mode_rehearsal_coverage_pct`, `stakeholder_proof_request_coverage_pct`)
  - deterministic drift signals (`quality_score_drop`, `quality_gap_growth`, `gap_severity_growth`, `high_severity_gap_growth`, `quality_readiness_drop`, `narrative_coverage_drop`, `dependency_coverage_drop`, `decision_sequencing_coverage_drop`, `close_scripts_coverage_drop`, `failure_mode_rehearsal_coverage_drop`, `stakeholder_proof_request_coverage_drop`)
  - deterministic escalation lanes by latest gap severity (`immediate_owner_escalation`, `same_day_quality_remediation`, `next_cycle_hardening`, `monitor_only`)
- trend artifact export metadata (`trend_artifacts`) with written/pruned file paths when enabled
- weekly SLO digest artifact export metadata (`slo_digest_artifacts`) with written/pruned file paths when enabled
