# Deploy + Continuity Runbook (Generic)

Goal: ship changes from local → repo → production reliably, without context loss.

## 0) Golden rules
- **One source of truth:** pick exactly one production pipeline (Git-based CI/CD OR CLI deploy). Don’t mix them.
- **Prove what’s live:** always verify production with a simple request (HTTP/curl) after deploy.
- **Write it down:** before sleeping / switching tasks, record “what I will do next” in a durable file.

## 1) Identify the production pipeline
Common patterns:
- **Git-based pipeline** (recommended): push to GitHub/GitLab → CI builds → deploy to prod
- **CLI-based pipeline:** `vercel deploy`, `firebase deploy`, `fly deploy`, `railway up`, etc.

If prod is showing code that doesn’t match the repo, assume prod may be sourced from a CLI deploy or from a different branch/repo.

## 2) Preflight checklist (local)
- App builds cleanly:
  - Node/Next: `npm run build`
  - Python: run tests + build
  - Docker: `docker build .`
- Env vars present for the target environment (DB URLs, API keys, etc.)
- No accidental secrets committed

## 3) Repo sanity
- Confirm remotes:
  ```bash
  git remote -v
  ```
- Confirm branch:
  ```bash
  git rev-parse --abbrev-ref HEAD
  ```
- Confirm your latest commit is present:
  ```bash
  git log -n 5 --oneline
  ```

## 4) Identity + permissions (the #1 silent deploy killer)
If deploy tooling rejects you based on “git author”, “committer”, or “SSO/team access”:

- Ensure your git identity matches an authorized account email:
  ```bash
  git config --global user.name "<Your Name>"
  git config --global user.email "<authorized-email@example.com>"
  ```

- If older commits have a bad author (e.g., `user@Mac.lan`) and the platform enforces author membership:
  ```bash
  git rebase --root --exec "git commit --amend --no-edit --reset-author"
  git push --force-with-lease
  ```

## 5) Deploy (choose one)
### A) Git-based deploy
1) Push branch
2) Confirm CI ran and produced a deployment
3) Promote/alias to production if required

### B) CLI-based deploy
- Run the CLI deploy command (varies by platform)
- Confirm the CLI output includes:
  - the deployment URL
  - the alias / domain binding / production promotion

## 6) Verify production (no guessing)
Always do one of these after deploy:
- Hit a known health endpoint: `/api/health`
- Or hit a deterministic endpoint and check output
- Or check server headers / build id

Example:
```bash
curl -s -i https://your-domain.com/api/health | sed -n '1,40p'
```

## 7) Continuity (prevents “we forgot what we agreed”)
Create/update a dated plan file before stopping work:
- `memory/YYYY-MM-DD.md`

Include:
- What we decided
- What’s being deployed
- What success looks like
- Next 1–3 actions
- Known blockers

## 8) Minimal checklist for any assistant/agent workflow
- Confirm repo + branch
- Confirm deploy pipeline
- Confirm credentials/permissions
- Deploy
- Verify with a real production request
- Write the next-step plan to a file

## 9) Markdown Audit Automation
- Run locally:
  ```bash
  npm run md:audit
  ```
- Run strict mode (non-zero exit on drift errors):
  ```bash
  npm run md:audit:strict
  ```
- CI workflow: `.github/workflows/markdown-audit.yml`
  - Runs on `pull_request` / `push` when markdown or audit config changes
  - Runs daily on schedule (`13:15 UTC`)
  - Uses strict mode so missing core workspace markdown files or policy conflicts fail the job

## 10) Hybrid DB bootstrap (SQLite + embeddings)
- Initialize/update the hybrid standard schema:
  ```bash
  npm run db:hybrid:init
  ```
- Migration sources live in `db/migrations/`.
- DB files should remain outside git and resolve via `OPENCLAW_DB_ROOT` (see `db/README.md`).

## 11) CRM ingestion (Gmail + Calendar daily)
- Run Gmail + Calendar ingestion into `hybrid-core.sqlite`:
  ```bash
  npm run db:hybrid:ingest
  ```
- For deterministic local verification (no live connector dependency), run against fixtures:
  ```bash
  npm run db:hybrid:ingest -- \
    --gmail-json scripts/db/fixtures/gmail-sample.json \
    --calendar-json scripts/db/fixtures/calendar-sample.json \
    --account richducat@gmail.com
  ```
- The script is incremental and updates source checkpoints in `ingestion_cursors`.

## 12) KB ingestion (URL/file sources)
- Run knowledge-base ingestion into `hybrid-core.sqlite`:
  ```bash
  npm run db:hybrid:ingest:kb -- --from-file scripts/db/fixtures/kb-sources-sample.json
  ```
- Or pass sources explicitly:
  ```bash
  npm run db:hybrid:ingest:kb -- \
    --file docs/reference/openclaw-docs-home.md \
    --url https://example.com/
  ```
- Optional controls:
  - `--max-chars <n>` and `--overlap-chars <n>` for deterministic chunking
  - `--embed` (plus optional `--embedding-model`) to store chunk embeddings when `OPENAI_API_KEY` is configured

## 13) Daily meeting prep brief (hybrid CRM)
- Generate a daily external-meeting prep brief from ingested hybrid CRM data:
  ```bash
  npm run db:hybrid:meeting-prep -- --date 2026-04-18 --account richducat@gmail.com
  ```
- JSON output mode (for downstream automations):
  ```bash
  npm run db:hybrid:meeting-prep -- --date 2026-04-18 --json
  ```
- Optional controls:
  - `--limit <n>` to cap number of meetings in the brief
  - `--internal-domain <domain>` (repeatable) to expand internal-only filters
- Output now includes:
  - attendee relationship snapshots (`7d/30d/90d` touchpoint counts + recent subjects)
  - attendee-level deterministic risk assessments (`low`/`medium`/`high`) with risk signals
  - attendee confidence scoring (`score`, `level`, rationale)
  - attendee relationship-risk deltas vs prior runs
  - deterministic next-action recommendations derived from touchpoint recency and RSVP status
  - meeting-level recommendations with confidence metadata
  - cross-attendee relationship risk signals for escalation-aware prep
  - meeting-level risk-delta summary vs prior runs

## 14) One-command daily hybrid pipeline
- Run schema init + CRM ingest + optional KB ingest + meeting prep in one command:
  ```bash
  npm run db:hybrid:daily -- \
    --account richducat@gmail.com \
    --date 2026-04-18 \
    --gmail-json scripts/db/fixtures/gmail-sample.json \
    --calendar-json scripts/db/fixtures/calendar-sample.json \
    --kb-from-file scripts/db/fixtures/kb-sources-sample.json \
    --brief-out memory/meeting-prep-2026-04-18.md
  ```
- Behavior:
  - Always prints a JSON summary of executed steps with `ok` / `partial_failure` / `failed` status.
  - Exits non-zero only if a step fails (`status=failed`).
  - Writes the meeting prep output to a file when `--brief-out` is provided.
- Optional controls:
  - `--skip-kb` to disable KB ingest for a run
  - `--brief-json` to write JSON brief output instead of markdown
  - `--internal-domain <domain>` (repeatable) forwarded to meeting prep filtering
  - `--allow-partial-sources` to allow CRM ingest to continue when one live connector source fails
  - `--connector-retries <n>`, `--connector-backoff-ms <n>`, `--connector-backoff-factor <n>` for live connector retry/backoff tuning

## 15) Scheduled hybrid daily run (canary + live lanes)
- Workflow: `.github/workflows/hybrid-daily-pipeline.yml`
- Runs:
  - daily at `13:20 UTC`
  - manual dispatch with inputs (`account`, `date`, `use_fixtures`, `live_mode`, `break_glass`, `break_glass_reason`, `skip_kb`, `max_lag_hours`, `max_seen_drift_hours`, `max_artifact_issues`)
- Artifacts kept for 14 days:
  - `meeting-prep-YYYY-MM-DD.md`
  - `pipeline-summary-YYYY-MM-DD.json`
  - `ingestion-health-YYYY-MM-DD.md`
  - `ingestion-health-YYYY-MM-DD.json`
  - live lane only:
    - `live-incident-ledger-YYYY-MM-DD-run-<run_id>-attempt-<run_attempt>.json`
    - `live-incident-ledger-YYYY-MM-DD-run-<run_id>-attempt-<run_attempt>.md`
- Artifact names now include execution lane:
  - `hybrid-daily-canary-YYYY-MM-DD`
  - `hybrid-daily-live-YYYY-MM-DD`
- Lane behavior:
  - **Canary lane** (schedule + manual with `live_mode=false`) runs on `ubuntu-latest`.
  - **Live lane** (manual with `live_mode=true`) runs on `self-hosted`.
- Default scheduled behavior remains fixture-backed deterministic canary.
- For live-source execution, use manual dispatch with `live_mode=true` (fixtures are not used in live lane).
- Live governance policy (enforced before preflight/pipeline):
  - Live job binds to protected GitHub Environment `hybrid-live`.
  - Live dispatch is restricted to `main` branch.
  - Live dispatch rejects `use_fixtures=true`.
  - Triggering actor must be listed in repo variable `HYBRID_LIVE_ALLOWED_ACTORS` (comma-separated usernames; defaults to `richducat` when unset).
  - Repo variable `HYBRID_LIVE_EMERGENCY_STOP=true` blocks live execution unless manual dispatch explicitly sets `break_glass=true`.
  - When `break_glass=true`, `break_glass_reason` must be non-empty or the run fails fast.
  - Workflow emits a `LIVE_AUDIT` log line recording actor, emergency-stop state, break-glass flag, and reason when used.
- Recommended environment setup:
  - Configure required reviewers for Environment `hybrid-live` so every live run requires explicit approval.
  - Keep `HYBRID_LIVE_ALLOWED_ACTORS` aligned with approved live operators.
  - Toggle `HYBRID_LIVE_EMERGENCY_STOP=true` during incident response or maintenance freezes; only use break-glass for audited emergency overrides.
- Live lane preflight checks before running pipeline:
  - `gog` binary must exist on runner PATH
  - Gmail connectivity probe succeeds for selected `account`
  - Calendar connectivity probe succeeds for selected `account`
- Workflow health gate:
  - runs `db:hybrid:health` after `db:hybrid:daily`
  - emits both markdown and JSON health artifacts
  - default breach thresholds:
    - `max_lag_hours=24`
    - `max_seen_drift_hours=48`
    - `max_artifact_issues=0`
  - threshold breach exits `2` and fails the run (artifacts still upload because upload step uses `if: always()`)
- Optional breach alert hook:
  - base route config:
    - `HYBRID_ALERT_WEBHOOK_URL` (single route)
    - `HYBRID_ALERT_WEBHOOK_URLS` (comma/newline multi-route fan-out)
  - optional escalation route config:
    - `HYBRID_ALERT_ESCALATION_WEBHOOK_URL`
    - `HYBRID_ALERT_ESCALATION_WEBHOOK_URLS`
    - `HYBRID_ALERT_ESCALATION_WINDOWS_ET` (repo variable, defaults to `always`)
  - escalation window format (`ET`):
    - `always`
    - or semicolon-delimited entries in `daySpec@HH:MM-HH:MM`
    - examples: `mon-fri@08:00-18:00;sat@09:00-12:00`, `sun@00:00-23:59`
  - on health-gate failure, workflow posts a JSON payload (`text`) to all configured base routes and includes escalation routes only when current ET falls inside configured escalation windows. Payload includes:
    - run mode (`canary` or `live`)
    - run URL
    - run date + threshold values
    - artifact label (`hybrid-daily-<mode>-YYYY-MM-DD`)
    - live-mode manual-approval + emergency-control context:
      - approval-required flag + approval environment
      - triggering actor + dispatch actor
      - emergency stop + break-glass flag/reason
      - incident-ledger artifact paths (json + markdown)
  - if no webhook routes are configured, workflow logs and skips outbound notification

## 16) Hybrid retrieval query (entities + chunks)
- Run ranked retrieval:
  ```bash
  npm run db:hybrid:query -- --query "appointment scheduling"
  ```
- Optional controls:
  - `--limit <n>` to cap result count
  - `--domain <crm|kb|ops|mixed>` (repeatable) to scope domains
  - `--type <entity_type>` (repeatable) to scope entity kinds
  - `--json` for machine-readable result output

## 17) Hybrid ingestion health dashboard (cursor drift + coverage)
- Run operator health summary:
  ```bash
  npm run db:hybrid:health
  ```
- JSON mode for automation:
  ```bash
  npm run db:hybrid:health -- --json
  ```
- Optional controls:
  - `--as-of <iso>` evaluates lag against a fixed timestamp
  - `--artifact-dir <path>` scans `pipeline-summary-*.json` artifacts for recent failure signals
  - `--artifacts-max <n>` controls how many recent artifact files to inspect
  - rolling baseline model controls:
    - `--baseline-window-runs <n>` prior runs per source for baseline bands (default `14`)
    - `--baseline-min-samples <n>` minimum prior runs before anomaly checks activate (default `5`)
    - `--baseline-sigma-multiplier <n>` MAD-based floor/ceiling band width multiplier (default `3`)
  - trend output controls:
    - `--trend-window-snapshots <n>` persisted baseline snapshots per source used for trend summaries (default `14`)
  - threshold guards (non-zero exit on breach):
    - `--max-lag-hours <n>`
    - `--max-seen-drift-hours <n>`
    - `--max-artifact-issues <n>`
    - `--max-entity-delta-pct <n>`
    - `--max-chunk-ratio-delta <n>`
    - `--max-link-delta-pct <n>`
    - `--max-baseline-anomalies <n>`
- Report fields include:
  - source cursor lag/drift for `gmail`, `google_calendar`, and `kb_ingest`
  - entity/chunk coverage totals and grouped `domain/type` counts
  - recent entity update snapshots
  - recent artifact-derived error/failure indicators (when artifacts exist)
  - source reconciliation (latest vs previous run) from `ingestion_run_metrics`, including:
    - entity delta + entity delta %
    - chunk-per-entity ratio drift
    - link delta + link delta %
  - source-specific rolling baseline floor/ceiling bands and anomaly flags for:
    - `records_scanned`
    - `entities_upserted`
    - `links_upserted`
  - persisted baseline snapshots written per health run in `ingestion_baseline_snapshots`:
    - source, health run time, current metric values, floor/ceiling bands, anomaly count/details
  - source trend summaries from persisted baseline snapshots:
    - anomaly direction and deltas versus oldest snapshot in configured window
    - directional metric deltas for records/entities/links
  - threshold metadata + explicit breach records in JSON mode

CI/alerting example:
```bash
npm run db:hybrid:health -- \
  --json \
  --max-lag-hours 24 \
  --max-seen-drift-hours 48 \
  --max-artifact-issues 0
```

Exit behavior:
- no threshold flags: report-only, exits `0`
- one or more threshold flags set: exits `2` if any configured threshold is breached
