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
  - attendee role-profile inference with deterministic role evidence signals
  - attendee-level stakeholder intent summary (`intent`, `approach`, `priority`, `confidence`, `signals`)
  - attendee relationship-risk deltas vs prior runs
  - deterministic next-action recommendations derived from touchpoint recency and RSVP status
  - role-aware prep brief items (priority-tagged) at meeting level
  - agenda-gap detection signals with deterministic recommendations
  - deterministic talking-point sequence for in-meeting flow control (`order`, `priority`, `objective`, `prompt`, `drivers`)
  - objection-rebuttal packs for medium/high-risk or unstable attendees (`objection`, `rebuttal`, `evidence`, `nextAsk`)
  - stakeholder intent rollup and negotiation fallback prompt packs for resistance handling (`trigger`, `prompt`, `desiredOutcome`, `priority`, `drivers`)
  - commitment closeout checklist to lock owner/date/risk-mitigation closure before meeting end (`check`, `priority`, `why`, `ownerHint`)
  - follow-up draft pack for deterministic post-meeting outbound (`subject`, `sendBy`, `summary`, `asks`, `recipientsHint`, `messageLines`)
  - commitment risk aging model for post-meeting carryover windows (`summary`, `windows`)
  - owner escalation prompt pack for deterministic ownership follow-through (`trigger`, `prompt`, `desiredOutcome`, `priority`, `ownerHint`)
  - stakeholder-ready narrative pack for concise executive-ready meeting storytelling (`headline`, `opening`, `middle`, `close`, `proofPoints`, `topDependencies`)
  - dependency-aware follow-through prompts for deterministic dependency closure (`trigger`, `prompt`, `desiredOutcome`, `priority`, `ownerHint`, `dependsOn`)
  - decision-commitment sequencing model for deterministic decision-order and owner/date lock sequencing (`summary`, `steps`)
  - stakeholder-specific close scripts for deterministic stakeholder closeout messaging (`attendee`, `trigger`, `script`, `desiredOutcome`, `priority`)
  - failure-mode rehearsals for deterministic contingency handling when commitments slip (`trigger`, `rehearsalQuestion`, `mitigationPath`, `ownerHint`, `evidenceToCapture`, `priority`, `dependsOn`)
  - stakeholder proof-request pack for explicit post-meeting proof capture (`attendee`, `request`, `rationale`, `dueWindow`, `priority`, `dependsOn`)
  - counterfactual decision-drill prompts for deterministic what-if decision resilience (`scenario`, `prompt`, `decisionFallback`, `ownerHint`, `priority`, `dependsOn`)
  - stakeholder objection-response handoff map for explicit objection ownership routing (`attendee`, `objectionTheme`, `responseOwner`, `responseScript`, `proofRequest`, `priority`, `dependsOn`)
  - meeting-prep quality scoring + coverage checks for output completeness (`score`, `level`, `gapCount`, `summary`, `coverageChecks`)
  - attendee confidence calibration telemetry from trailing 30-day snapshot history (`currentConfidenceScore`, trailing baselines, deltas)
  - meeting-level confidence calibration trend summary (`currentAverageConfidence`, `trailingAverageConfidence`, `averageDelta`, trend signals)
  - deterministic action-owner load balancing suggestions (`ownerCapacity`, `suggestedAssignments`) to distribute recommendation/closeout actions
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
- manual dispatch with inputs (`account`, `date`, `use_fixtures`, `live_mode`, `break_glass`, `break_glass_reason`, `skip_kb`, `max_lag_hours`, `max_seen_drift_hours`, `max_artifact_issues`, `max_drift_signals`, `max_drift_severity_score`, `max_quality_drift_signals`, `max_quality_severity_score`, `incident_age_warning_minutes`, `incident_age_critical_minutes`)
- Artifacts kept for 14 days:
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
  - exports deterministic trend audit artifacts in `artifacts/` (`--trend-artifact-dir artifacts --trend-artifact-prefix ingestion-trends`)
  - exports weekly SLO digest artifacts in `artifacts/` (`--slo-digest-dir artifacts --slo-digest-prefix ingestion-slo-weekly --slo-window-days 7`)
  - keeps trend artifacts bounded in CI lane by count (`--trend-retention-count 180`)
  - keeps SLO digest artifacts bounded in CI lane by count (`--slo-retention-count 52`)
  - default breach thresholds:
    - `max_lag_hours=24`
    - `max_seen_drift_hours=48`
    - `max_artifact_issues=0`
    - `max_slo_budget_burn_pct=100`
  - optional quality-drift thresholds:
    - `max_quality_drift_signals`
    - `max_quality_severity_score`
    - `max_quality_readiness_drop`
    - `min_quality_narrative_coverage_pct`
    - `min_quality_dependency_coverage_pct`
    - `min_quality_decision_sequencing_coverage_pct`
    - `min_quality_close_scripts_coverage_pct`
  - threshold breach exits `2` and fails the run (artifacts still upload because upload step uses `if: always()`)
- Live drift detector (live lane):
  - resolves latest same-date canary artifact (`hybrid-daily-canary-YYYY-MM-DD`) from GitHub Actions artifacts
  - compares canary vs live health JSON with `npm run db:hybrid:drift`
  - always emits evidence artifacts (`canary-live-drift-YYYY-MM-DD.{json,md}`)
  - if `max_drift_signals` input is blank, drift check is report-only
  - if `max_drift_signals` is set, drift check exits `2` when signal count exceeds threshold
  - if `max_drift_severity_score` is set, drift check exits `2` when severity-weighted total exceeds threshold
  - drift output includes deterministic signal taxonomy and rollups (`category`, `severity_weight`, `severity_counts`, `category_counts`, `total_severity_score`)
- Optional breach alert hook:
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
      - `incident_type.<health_gate_breach|drift_signal_detected|drift_gate_breach|quality_drift_signal_detected|quality_drift_gate_breach|quality_phase12_signal_detected|quality_phase12_gate_breach|quality_phase13_signal_detected|quality_phase13_gate_breach>`
      - `incident_age_band.<new|fresh|aging|critical>`
    - each node supports:
      - `ack_sla_minutes`
      - `ack_reminder_interval_minutes`
      - `ack_escalate_after_reminders`
      - `ack_stale_after_minutes`
  - optional incident-age thresholds (repo vars; workflow dispatch inputs can override per run):
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
    - `HYBRID_ALERT_ACK_EVIDENCE_STALE_AFTER_MINUTES` (default `10080`; drops stale evidence entries during ingestion)
    - `HYBRID_ALERT_ACK_STALE_AFTER_MINUTES` (default `1440`; marks pending incidents stale when not seen recently)
  - optional ACK evidence ingestion directory:
    - on failure, workflow ingests `artifacts/ack-evidence/*.json` and merges results with repo-variable ACK evidence lists
    - accepted JSON supports `ack_marker`, `ack_key`, optional `acknowledged_at_utc`, plus aggregate `ack_markers` / `ack_keys` / `acknowledgements` fields
  - ACK evidence ingestion artifacts emitted on failure:
    - `ack-evidence-YYYY-MM-DD.json`
    - `ack-evidence-YYYY-MM-DD.md`
  - ACK reminder digest + dispatch summary artifacts emitted on failure:
    - `ack-reminder-digest-YYYY-MM-DD-<mode>.json`
    - `ack-reminder-digest-YYYY-MM-DD-<mode>.md`
    - `dispatch-alert-summary-YYYY-MM-DD-<mode>.json`
    - failure-path upload artifact bundles:
      - `hybrid-daily-canary-ack-YYYY-MM-DD`
      - `hybrid-daily-live-ack-YYYY-MM-DD`
  - escalation window format (`ET`):
    - `always`
    - or semicolon-delimited entries in `daySpec@HH:MM-HH:MM`
    - examples: `mon-fri@08:00-18:00;sat@09:00-12:00`, `sun@00:00-23:59`
  - on health-gate failure, workflow posts a JSON payload (`text` + `metadata`) to all configured base routes and includes escalation routes only when current ET falls inside configured escalation windows
  - when drift signals are present (`signal_count > 0` or drift gate breached), drift routes are also included; drift escalation routes are ET-window gated like base escalation
  - when meeting-prep quality drift signals are present (`quality_signal_count > 0` or quality gate breached), quality routes are also included; quality escalation routes are ET-window gated like base escalation
  - payload includes:
    - run mode (`canary` or `live`)
    - run URL
    - run date + threshold values
    - artifact label (`hybrid-daily-<mode>-YYYY-MM-DD`)
    - live-mode manual-approval + emergency-control context:
      - approval-required flag + approval environment
      - triggering actor + dispatch actor
      - emergency stop + break-glass flag/reason
      - incident-ledger artifact paths (json + markdown)
      - canary-vs-live drift summary (`status`, `signal_count`, `total_severity_score`, `gate_breached`, `gate_breached_by_signal_count`, `gate_breached_by_severity_score`)
      - canary-vs-live drift artifact paths (json + markdown)
      - deterministic ACK metadata (`ack_key`, `ack_marker`, `ack_sla_minutes`, `ack_due_at_utc`, `ack_due_at_et`, `ack_policy`, `ack_policy_applied`, `ack_policy_parse_error`)
      - deterministic incident-age metadata (`incident_age_minutes`, `incident_age_band`, `incident_age_warning_minutes`, `incident_age_critical_minutes`, `incident_age_escalation_due`, `incident_first_seen_at_utc`)
      - quality drift metadata (`quality_drift_signal_count`, `quality_severity_score`, `quality_gate_breached`, `quality_top_lane`, `quality_top_lane_severity`)
      - phase-13 quality breach metadata (`quality_phase13_gate_breached`, `quality_confidence_calibration_breach_count`, `quality_owner_assignment_breach_count`, `quality_phase13_top_breach_kind`)
      - phase-12 quality breach metadata (`quality_phase12_gate_breached`, `quality_failure_mode_rehearsal_breach_count`, `quality_stakeholder_proof_request_breach_count`, `quality_phase12_top_breach_kind`)
      - ACK reconciliation/reminder metadata (`ack_reconciled`, `ack_reconciliation_source`, `ack_reminders_due_count`, `ack_reminder_escalations_due_count`)
      - ACK stale-expiry metadata (`ack_stale_after_minutes`, `ack_stale_pending_count`, `ack_newly_stale_count`)
      - ACK evidence-ingestion metadata (`ack_evidence_active_marker_count`, `ack_evidence_active_key_count`, `ack_evidence_stale_entry_count`, `ack_evidence_parse_error_count`, `ack_evidence_json`)
      - ACK evidence normalization contract (`ack_evidence_contract`) with deterministic fields:
        - `schema_version`, `source_path`, `source_present`, `source_valid`
        - `active_marker_count`, `active_key_count`, `stale_entry_count`, `parse_error_count`
      - ACK SLA/reminder contract (`ack_sla_reminder_contract`) with deterministic fields:
        - `schema_version`, `policy_name`, `policy_applied`
        - `sla_minutes`, `reminder_interval_minutes`, `escalate_after_reminders`, `stale_after_minutes`
        - `ack_required`, `ack_due_at_utc`, `ack_due_at_et`
        - `ack_reconciled`, `ack_reconciled_at_utc`, `ack_reconciliation_source`
        - `reminders_due_count`, `reminder_escalations_due_count`
        - `stale_pending_count`, `newly_stale_count`
        - `incident_age_minutes`, `incident_age_band`, `incident_age_escalation_due`
      - escalation summary contract (`escalation_summary`) with deterministic policy + route fields:
        - `policy.windows_et`, `policy.et_now`, `policy.incident_type`, `policy.incident_drift_related`, `policy.incident_quality_related`
        - `policy.incident_age_band`, `policy.incident_age_minutes`, `policy.incident_age_warning_minutes`, `policy.incident_age_critical_minutes`, `policy.incident_age_escalation_due`
        - `routes.base_configured_count`, `routes.escalation_configured_count`, `routes.drift_configured_count`, `routes.drift_escalation_configured_count`, `routes.quality_configured_count`, `routes.quality_escalation_configured_count`
        - `routes.ack_reminder_configured_count`, `routes.ack_reminder_escalation_configured_count`
        - `routes.escalation_enabled`, `routes.drift_escalation_enabled`, `routes.quality_escalation_enabled`, `routes.reminder_escalation_due_count`
  - dispatcher persists ACK tracker state to `ALERT_ACK_STATE_PATH` and reconciles prior unresolved incidents when evidence vars are provided
  - stale pending ACK incidents are auto-marked `stale` after the configured expiry window and excluded from reminder fan-out
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
  - trend artifact export + retention controls:
    - `--trend-artifact-dir <path>` writes trend audit snapshot artifacts (`.md` + `.json`)
    - `--trend-artifact-prefix <stem>` file prefix for exported trend artifacts (default `ingestion-trends`)
    - `--trend-retention-days <n>` prunes exported trend artifacts older than `n` days
    - `--trend-retention-count <n>` keeps only the newest `n` exported trend snapshots (markdown+json pair)
  - weekly SLO digest controls:
    - `--slo-window-days <n>` digest window in days for snapshot + breach rollup summaries (default `7`)
    - `--slo-digest-dir <path>` writes weekly SLO digest artifacts (`.md` + `.json`)
    - `--slo-digest-prefix <stem>` file prefix for exported SLO digest artifacts (default `ingestion-slo-weekly`)
    - `--slo-retention-days <n>` prunes exported SLO digest artifacts older than `n` days
    - `--slo-retention-count <n>` keeps only the newest `n` exported SLO digest snapshots (markdown+json pair)
  - source-level SLO budget controls:
    - `--slo-budget-window-days <n>` run-history window in days for source budget tracking (default `7`)
    - `--slo-target-default-pct <n>` default target availability percentage for all sources (default `99`)
    - `--slo-target-gmail-pct <n>` Gmail source target availability percentage override
    - `--slo-target-google-calendar-pct <n>` Google Calendar source target availability percentage override
    - `--slo-target-kb-ingest-pct <n>` KB ingest source target availability percentage override
    - `--slo-partial-failure-weight <n>` weighted error cost for `partial_failure` runs in budget burn calculations (default `0.5`)
    - `--slo-seasonality-window-days <n>` lookback days used to build source day-of-week error profiles (default `56`)
    - `--slo-seasonality-min-runs <n>` minimum current-weekday runs required before fallback to median day profile (default `4`)
    - `--slo-seasonality-band-multiplier <n>` MAD band width multiplier for expected day-profile error rate bands (default `1.5`)
    - `--slo-adaptive-burn-min-multiplier <n>` lower clamp for adaptive burn multiplier (default `0.6`)
    - `--slo-adaptive-burn-max-multiplier <n>` upper clamp for adaptive burn multiplier (default `1.8`)
  - threshold guards (non-zero exit on breach):
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
    - `--max-quality-confidence-calibration-drop <n>`
    - `--min-quality-narrative-coverage-pct <n>`
    - `--min-quality-dependency-coverage-pct <n>`
    - `--min-quality-decision-sequencing-coverage-pct <n>`
    - `--min-quality-close-scripts-coverage-pct <n>`
    - `--min-quality-failure-mode-rehearsal-coverage-pct <n>`
    - `--min-quality-stakeholder-proof-request-coverage-pct <n>`
    - `--min-quality-owner-assignment-coverage-pct <n>`
    - `--min-quality-counterfactual-decision-drill-coverage-pct <n>`
    - `--min-quality-stakeholder-objection-handoff-coverage-pct <n>`
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
  - weekly SLO digest from persisted baseline snapshots:
    - digest window summary + source-level anomaly-free coverage
    - source-level average/latest anomaly counts
  - source-level SLO budget tracking from `ingestion_run_metrics`:
    - run mixes (`ok`, `partial_failure`, `failed`) for each source in the configured budget window
    - source weekday seasonality profiles (`utc_weekday`) with expected error-rate floor/ceiling bands
    - weighted error rate, error budget, raw burn %, adaptive burn %, raw/adaptive burn rates, and remaining budget %
    - deterministic budget status + alert level for burn escalation handling (adaptive burn basis)
  - breach rollup feed for digest window:
    - scans `ingestion-trends-*.json` and `ingestion-health-*.json`
    - aggregates breach events by severity and source/top breach kinds
  - threshold metadata + explicit breach records in JSON mode
  - meeting-prep quality trendline drift analysis:
    - scans `meeting-prep-quality-*.json` + `meeting-prep-phase*.json`
    - emits deterministic drift signals and severity-based escalation lanes
    - includes readiness/coverage metrics (`readiness_score`, `narrative_coverage_pct`, `dependency_coverage_pct`, `decision_sequencing_coverage_pct`, `close_scripts_coverage_pct`, `failure_mode_rehearsal_coverage_pct`, `stakeholder_proof_request_coverage_pct`, `confidence_calibration_coverage_pct`, `confidence_calibration_avg_delta`, `owner_assignment_coverage_pct`, `counterfactual_decision_drill_coverage_pct`, `stakeholder_objection_handoff_coverage_pct`)
  - trend artifact export metadata (`trend_artifacts`) with written/pruned files when export is enabled
  - weekly SLO digest artifact export metadata (`slo_digest_artifacts`) with written/pruned files when export is enabled

CI/alerting example:
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
  --max-quality-confidence-calibration-drop 999 \
  --min-quality-narrative-coverage-pct 0 \
  --min-quality-dependency-coverage-pct 0 \
  --min-quality-decision-sequencing-coverage-pct 0 \
  --min-quality-close-scripts-coverage-pct 0 \
  --min-quality-failure-mode-rehearsal-coverage-pct 0 \
  --min-quality-stakeholder-proof-request-coverage-pct 0 \
  --min-quality-owner-assignment-coverage-pct 0 \
  --min-quality-counterfactual-decision-drill-coverage-pct 0 \
  --min-quality-stakeholder-objection-handoff-coverage-pct 0
```

Exit behavior:
- no threshold flags: report-only, exits `0`
- one or more threshold flags set: exits `2` if any configured threshold is breached
