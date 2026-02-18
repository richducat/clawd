# Context Anchor (internal)

Last updated: 2026-02-18 16:02 ET

## 1) Source reads (internal summary)
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
  - LabStudio: **no mock data** in user-visible UI (must be DB/integration-backed; seeding OK if it writes to DB).
  - OpenClaw dual-Mac rules: one LaunchAgent per Mac; don’t copy `~/.openclaw*`; office uses `--profile office`.

## 2) Top 10 commitments (bullets)
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

## 3) Today’s non-negotiables (courts/school + backups + RC updates)
- Courts/school:
  - Email watch jobs (7:30am ET + 4:40pm ET) must run; any replies are **draft-only**.
  - Berkeley speech weekly check-in draft (Wed 4:30pm ET) must run (draft-only, reply-in-thread).
- Backups:
  - Hourly git auto-sync (job `d43e5f81-...`) must stay green.
  - Nightly OpenClaw state backups (Drive + local sync) must stay green.
- RingCentral / TYFYS updates:
  - Morning RC: update + lead buckets + KPI scoreboard + verification must stay green.
  - Day-cap RC update (4:00pm ET weekdays) must stay green.

## 4) Active workstreams + next actions
### A) Context anchoring / operating system
- Next actions (next work block):
  - Create `memory/goals-master.md` (canonical goals + weekly focus + top priorities).
  - Restore daily-note continuity: create missing daily files (at minimum `2026-02-16.md`; optionally backfill `2026-02-17.md` + start `2026-02-18.md`).
  - If daily-file convention intentionally changed, patch cron payload(s) to point at the real canonical file(s).

### B) TYFYS automations (RingCentral + Zoho)
- Next actions:
  - Keep token health stable (Zoho + RingCentral). If `invalid_grant`, refresh via per-user oauth refresh script.
  - Fix outbound SMS autopilot runtime so it reliably completes inside cron timeout (see breakages).

### C) LabStudio
- Next actions:
  - Continue incremental PR-sized improvements during scheduled build blocks.
  - Revisit the disabled one-shot deploy job only after delivery channel is corrected (or set to `delivery.mode: none`).

### D) DriftGuard / hygiene
- Next actions:
  - Ensure any automation edits within 24h get recorded here (and/or via DriftGuard preflight “Recent automation changes”).

## 5) Cron health (jobs with lastStatus=error in last 24h)
- Enabled:
  - `0aa2a6d7-2921-43d7-9242-c7c75c75122d` (TYFYS outbound SMS autopilot): `Error: cron: job execution timed out` (consecutiveErrors=1)

## 6) Detected breakages + the fix to apply next (queued; do NOT action now)
1) **Anchor inputs missing** (`goals-master.md` + `2026-02-16.md` don’t exist)
   - Fix plan:
     - Create `memory/goals-master.md` with: Top 5 goals, Top 3 workstreams, today’s non-negotiables, and a “this week” section.
     - Create `memory/2026-02-16.md` (and optionally 2/17–2/18). Add a small “plan tomorrow” section.
2) **Daily-note continuity break** (no 2/16–2/18 daily files)
   - Fix plan:
     - Add lightweight guardrail: ensure today’s `memory/YYYY-MM-DD.md` exists by noon, and has a “next actions” list by EOD.
3) **TYFYS outbound SMS autopilot timeout** (enabled job error)
   - Hypothesis: run exceeds cron timeout due to Zoho paging / RC throttling / `--leadLimit 120`.
   - Fix plan:
     - Repro locally with `--dry-run` and smaller limits (e.g., `--leadLimit 40`) to baseline runtime.
     - Implement batching/cursor in `memory/tyfys-sms-autopilot.json` (process N leads per run).
     - Add RC rate-limit backoff + cap per run; keep cron `timeoutSeconds` as-is unless absolutely necessary.
4) **Historical one-shot jobs show delivery misroute** (`Unsupported channel: whatsapp`)
   - Low priority (those jobs are disabled), but indicates a configuration footgun.
   - Fix plan:
     - For future topic/one-shot jobs: explicitly set `delivery.channel: telegram` + `delivery.to`, or `delivery.mode: none` when purely internal.
