# Context Anchor (internal)

Last updated: 2026-02-18 15:02 ET

## Source reads (internal summary)
- ⚠️ Missing files (cron payload points at these, but they don’t exist on disk):
  - `/Users/richardducat/clawd/memory/goals-master.md`
  - `/Users/richardducat/clawd/memory/2026-02-16.md`
- Memory folder reality check:
  - Daily notes exist through `2026-02-15.md`.
  - No `2026-02-16.md`, `2026-02-17.md`, or `2026-02-18.md` present.
- MEMORY.md skim (operating rules / non-negotiables):
  - Draft-first for **all** outbound emails until explicitly approved to send.
  - **Do not email Karen back** automatically (draft-only; no sending without explicit approval).
  - Autonomy + low-friction: if ≥70% sure and safe/reversible, decide and proceed; only ask when safety/permissions/irreversible.
  - For code/work: PR-sized changes; do not push live; Richard tests/commits.
  - LabStudio: **no mock data** in user-visible UI (must be DB/integration-backed).
  - OpenClaw dual-Mac rules: one LaunchAgent per Mac; don’t copy `~/.openclaw*`; office uses `--profile office`.

## Top 10 commitments (operating commitments)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically (draft-only; wait for approval).
3) Ship one tangible, testable deliverable regularly (PR-sized; <400 lines net when possible).
4) LabStudio UI must be real-data-backed (no mock data).
5) TYFYS privacy/rep-safety: avoid client PII/PHI; no Stripe/private-financials in rep posts.
6) Keep RingCentral automations healthy (AM posts + verification + day-cap + ops brief).
7) Keep backups healthy (hourly git auto-sync; nightly OpenClaw state backups).
8) Change-control: key decisions/automation changes must land in memory files, not just chat.
9) Avoid drift collisions: prevent duplicate cron commands / shared state-file collisions.
10) Keep OpenClaw office/travel separation stable (one gateway per Mac, correct profile usage).

## Today’s non-negotiables (Wed)
- Courts/school:
  - Email watch jobs (AM + 4:40pm ET) must run; any replies are **draft-only**.
- Backups:
  - Hourly git auto-sync (job `d43e5f81-...`) must stay green.
  - Nightly OpenClaw state backups (Drive + local sync) must stay green.
- RingCentral / TYFYS updates:
  - Morning Sales Team RC update + lead buckets + KPI scoreboard + verification (weekday schedule) must stay green.
  - Day-cap RC update (4:00pm ET) must stay green.

## Active workstreams + next actions
### 1) Context anchoring / operating system
- Next actions:
  - Create `memory/goals-master.md` (canonical goals + priorities + weekly focus).
  - Restore daily-note continuity: create missing daily files (at minimum `2026-02-16.md` per cron payload; optionally backfill `2026-02-17.md` + `2026-02-18.md`).
  - If the daily-file convention changed, patch the cron payload(s) to point at the real canonical file.

### 2) LabStudio
- Next actions:
  - Continue incremental PR-sized improvements during scheduled build blocks.
  - Investigate the failed one-shot deploy job (below) and decide a safe re-run plan when in a work block.

### 3) TYFYS automations
- Next actions:
  - Monitor token health (Zoho + RingCentral). If `invalid_grant`, refresh via the per-user oauth refresh script.
  - Unblock outbound SMS autopilot runtime (see breakages) so it reliably completes inside cron timeout.

### 4) DriftGuard / hygiene
- Next actions:
  - Ensure any automation edits within 24h get recorded here (and/or via DriftGuard preflight "Recent automation changes").

## Cron health (quick check)
- Enabled jobs with `lastStatus=error` in last 24h:
  - `0aa2a6d7-2921-43d7-9242-c7c75c75122d` (TYFYS outbound SMS autopilot): `Error: cron: job execution timed out`

## Detected breakages + queued fix (do NOT action now; next work block)
1) **Anchor inputs missing** (`goals-master.md` + `2026-02-16.md` don’t exist)
   - Fix plan:
     - Create `memory/goals-master.md` with: top 5 goals, top 3 workstreams, hard non-negotiables, and a short “this week” section.
     - Create `memory/2026-02-16.md` (and optionally backfill 2/17–2/18) OR update this cron job’s payload to the correct daily filename convention.
2) **Daily-note continuity break** (no 2/16–2/18 daily files in memory folder)
   - Fix plan:
     - Decide/confirm canonical convention (one file per day, named `YYYY-MM-DD.md`).
     - Add a lightweight guard (cron or heartbeat) that ensures today’s `memory/YYYY-MM-DD.md` exists and gets a “next-day plan” section by EOD.
3) **TYFYS outbound SMS autopilot timeout** (enabled job error)
   - Hypothesis: run is exceeding cron timeout (240s) due to Zoho paging / RC throttling / template selection / large leadLimit.
   - Fix plan:
     - First-run repro locally with `--dry-run` and smaller limits (e.g., `--leadLimit 40`) to get baseline runtime.
     - Reduce default leadLimit, or add internal batching (process N leads per run, persist cursor in `memory/tyfys-sms-autopilot.json`).
     - If RC calls are rate-limited, add exponential backoff + hard cap per run.
     - Update cron timeoutSeconds upward only if necessary (prefer making the script fast).
4) **LabStudio deploy one-shot errored due to channel misroute** (`Unsupported channel: whatsapp`)
   - Note: this job is currently disabled, but indicates a mis-set/implicit delivery channel.
   - Fix plan:
     - For internal automation jobs: set `delivery.mode: none`.
     - If announcements are needed: explicitly set `delivery.channel: telegram` + `delivery.to`.
     - Patch/recreate the one-shot deploy job accordingly before re-running.
5) **Historical disabled Telegram-topic one-shots misrouted** (`Unsupported channel: whatsapp`)
   - Low priority since disabled; cleanup plan: delete old one-shots or enforce explicit delivery channels for future topic jobs.
