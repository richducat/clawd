# Context Anchor (internal)

Last updated: 2026-02-19 13:02 ET

## Source reads (internal summary)
- ⚠️ Missing files (still):
  - `/Users/richardducat/clawd/memory/goals-master.md` (not found)
  - `/Users/richardducat/clawd/memory/2026-02-16.md` (not found)
- Read instead (to prevent drift):
  - `/Users/richardducat/clawd/memory/2026-02-15.md`: OpenClaw dual-Mac stabilization rules (office “brain” profile vs travel “cockpit”; don’t copy `~/.openclaw*`; one LaunchAgent per Mac).
- MEMORY.md skim (operating rules / non-negotiables):
  - **Draft-first for all outbound emails** until explicitly approved to send.
  - **Do not email Karen back automatically** (draft-only; no sending to Karen without explicit approval).
  - Low-friction rule: if ≥70% sure and safe/reversible, decide and proceed.
  - Code/work: PR-sized changes; do not push live; Richard tests/commits.
  - LabStudio: **no mock data** in user-visible UI (real DB/integration-backed only).

## Top 10 commitments (operating commitments)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically (draft-only; wait for explicit approval).
3) Ship one tangible, testable deliverable on steady cadence (PR-sized; ideally <400 net lines).
4) LabStudio: real DB/integration-backed UI only (no mock data in user-visible flows).
5) TYFYS: protect privacy; no client PII/PHI leakage; rep-safe where required.
6) Keep RingCentral automations healthy (AM posts + verification; inbound/outbound SMS guardrails).
7) Keep backups healthy (hourly git autosync; nightly OpenClaw state bundle backups).
8) Maintain change-control: decisions shouldn’t live only in chat—anchor in memory files.
9) Avoid drift collisions: detect/disable duplicates; minimize overlapping automations + shared state-file clashes.
10) Keep dual-Mac OpenClaw separation stable (office brain vs travel cockpit; never copy OpenClaw state dirs).

## Today’s non-negotiables (courts/school + backups + RC updates)
- Courts/school:
  - Email watch (courts + schools): **7:30am ET** + **4:40pm ET** (draft-only replies).
  - Daily 6:15am ops scan includes court/school searches (draft-only).
- Backups:
  - Hourly git auto-sync: job `d43e5f81-...` (runs at :05 past the hour).
  - Nightly OpenClaw state bundle backups: Drive + local sync (**2:30am + 2:40am ET**).
- RingCentral (TYFYS):
  - Weekday AM: Morning Sales Team update (8:30), lead buckets (8:32), KPI scoreboard (8:35), verification (8:40).
  - Weekday PM: Day Cap update (4:00pm ET).
  - Inbound routing + inbound auto-replies + outbound autopilot run in windows (guardrails in payloads).

## Active workstreams + next actions
### 1) Context anchoring (prevent drift)
- Next action: fix missing anchor source files OR update the anchor job’s paths to the canonical ones.
  - Preferred: create `memory/goals-master.md` seeded with current goals/priorities.
  - Preferred: create `memory/2026-02-16.md` retro-log + next-day plan (or point to an existing date file).

### 2) LabStudio
- Ongoing: weekday build blocks (11am / 2pm / 5pm ET) are active.
- Next action: keep progress PR-oriented (branch + small commits + `pnpm build`) and avoid prod deploy unless explicitly approved.

### 3) TYFYS automations (Zoho + RingCentral)
- Next action: keep an eye on token/auth failures (`invalid_grant`) and fix via per-user RC refresh script when needed.
- Keep Jared excluded where payload says excluded (token/extension mismatch) to avoid noisy failures.

### 4) DriftGuard / hygiene
- Next action: if any cron/automation edits happen via UI, ensure they get written back into this file.

## Cron health (quick scan)
- Enabled jobs with `lastStatus=error` in the last ~24h: **none detected**.
- Notes:
  - There are older, disabled one-shot errors (mostly misrouted deliveries: `Unsupported channel: whatsapp`).

## Detected breakages + queued fix (do next available work block)
1) **Missing anchor inputs**: `goals-master.md` and `2026-02-16.md` paths don’t exist.
   - Fix (queued): create those files (preferred) OR change the context-anchor job payload to point at existing canonical files.
2) **Stale/incorrect anchor risk**: context-anchor previously recorded specific job errors; those appear cleared now (current cron list shows lastStatus=ok for enabled jobs).
   - Fix (queued): keep this section strictly derived from `cron list` at runtime; don’t carry forward old error notes unless still present.
3) **Old one-shot deliveries misrouted** (disabled): `Unsupported channel: whatsapp`.
   - Fix (queued, low priority): delete old one-shots or ensure future one-shots explicitly set `delivery.channel=telegram`.
