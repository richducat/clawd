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

## 15) Scheduled hybrid daily run (artifact retention)
- Workflow: `.github/workflows/hybrid-daily-pipeline.yml`
- Runs:
  - daily at `13:20 UTC`
  - manual dispatch with inputs (`account`, `date`, `use_fixtures`, `skip_kb`)
- Artifacts kept for 14 days:
  - `meeting-prep-YYYY-MM-DD.md`
  - `pipeline-summary-YYYY-MM-DD.json`
- Default scheduled/manual behavior uses repository fixtures for deterministic canary runs.
- For live-source execution, run manually on an environment with live source prerequisites and set `use_fixtures=false`.

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
  - threshold guards (non-zero exit on breach):
    - `--max-lag-hours <n>`
    - `--max-seen-drift-hours <n>`
    - `--max-artifact-issues <n>`
- Report fields include:
  - source cursor lag/drift for `gmail`, `google_calendar`, and `kb_ingest`
  - entity/chunk coverage totals and grouped `domain/type` counts
  - recent entity update snapshots
  - recent artifact-derived error/failure indicators (when artifacts exist)
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
