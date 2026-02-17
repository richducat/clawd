# Context Anchor (internal)

Last updated: 2026-02-16 21:02 ET

## Source reads (internal summary)
- ⚠️ Missing files:
  - `/Users/richardducat/clawd/memory/goals-master.md` (not found)
  - `/Users/richardducat/clawd/memory/2026-02-16.md` (not found)
- MEMORY.md skim (operating rules / non-negotiables):
  - Draft-first for *all* outbound emails until explicitly approved to send.
  - Do **not** email Karen back (draft-only; no sending to Karen without explicit approval).
  - Be proactive + low-friction: if ≥70% sure and safe/reversible, decide and proceed.
  - For code/work: PR-sized changes; do not push live; Richard tests/commits.
  - LabStudio: **no mock data** in user-visible UI.
  - OpenClaw dual-Mac rules: one LaunchAgent per Mac; don’t copy `~/.openclaw*`; office uses `--profile office`.

## Top 10 commitments (current operating commitments)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically (draft-only; wait for approval).
3) Ship one tangible, testable deliverable (PR-sized) on a steady cadence.
4) LabStudio: real DB/integration-backed UI only (no mock data).
5) TYFYS: protect privacy (no client PII/PHI leakage; rep-safe where required).
6) Keep RingCentral automations healthy (morning posts + verification + ops brief).
7) Keep backup jobs healthy (hourly git autosync; nightly OpenClaw state backups).
8) Maintain change-control: decisions shouldn’t live only in chat—anchor in memory files.
9) Avoid drift collisions: detect/disable duplicates; minimize overlapping automations.
10) Keep dual-Mac OpenClaw separation stable (office brain vs travel cockpit).

## Today’s non-negotiables (template)
- Courts/school watch: morning + afternoon email scans; draft-only replies.
- Backups:
  - Hourly git auto-sync (cron: `d43e5f81-...`) ✅ scheduled
  - Nightly OpenClaw state backup to Drive + local sync ✅ scheduled
- RingCentral updates:
  - Morning Sales Team RC update + lead buckets + KPI scoreboard + verification ✅ scheduled (weekdays)
  - Ops brief (Mon–Sat) ✅ scheduled

## Active workstreams + next actions
### 1) Context anchoring
- Next action: create the missing anchor source files (or update cron paths) so this job is grounded in real goals + daily plan.

### 2) LabStudio
- Next action: be ready for `LabStudio deploy: shop-on-prod-baseline` (job `e69a0b5d-...` at 2026-02-17 02:55Z) once quota resets.
- Guardrail: do not deploy to prod without explicit approval beyond the queued job; keep changes PR-sized.

### 3) TYFYS automations
- Next action: keep an eye on RC/TYFYS jobs; if any start erroring, fix smallest safe issue (tokens, criteria paging, etc.).

### 4) DriftGuard / hygiene
- Next action: ensure any automation edits within 24h are written into this file (preflight job will also append changes).

## Cron health (last 24h)
- Enabled jobs with `lastStatus=error` in last 24h: **none detected**.
- Notable errors seen (disabled one-shots): Telegram topic pings failed with `Unsupported channel: whatsapp` (jobs `df8f1ae3-...`, `464cbf82-...`, `806bdedf-...`, `0338f6fa-...`).

## Detected breakages + queued fix
1) **Missing anchor inputs**: goals-master + daily memory file paths don’t exist.
   - Fix next work block:
     - Create `memory/goals-master.md` (seed with current top priorities + quarterly goals).
     - Create `memory/2026-02-16.md` (retro-log + next-day plan).
     - OR update cron payload paths if the canonical filenames differ.
2) **Disabled Telegram-topic one-shots misrouted**: historical jobs attempted Telegram deliveries but errored as whatsapp.
   - Fix (low priority since disabled): delete old one-shot jobs or correct delivery channel defaults when creating future telegram posts.
