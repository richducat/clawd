# Context Anchor (internal)

Last updated: 2026-02-19 16:02 ET

## Source reads (internal summary)
- ⚠️ Missing anchor inputs (still):
  - `/Users/richardducat/clawd/memory/goals-master.md` (ENOENT)
  - `/Users/richardducat/clawd/memory/2026-02-16.md` (ENOENT)
- MEMORY.md skim (operating rules / non-negotiables):
  - **Draft-first for all outbound emails** until explicitly approved to send.
  - **Do not email Karen back automatically** (draft-only; no sending to Karen without explicit approval).
  - Low-friction rule: if ≥70% sure and safe/reversible, decide and proceed.
  - Code/work: PR-sized changes; do not push live; Richard tests/commits.
  - LabStudio: **no mock data** in user-visible UI (real DB/integration-backed only).
  - OpenClaw stability: don’t copy `~/.openclaw*` between Macs; run one LaunchAgent per Mac; office vs travel profiles.

## Top 10 commitments (operating commitments)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically (draft-only; wait for explicit approval).
3) Ship one tangible, testable deliverable on steady cadence (PR-sized; ideally <400 net lines).
4) LabStudio: real DB/integration-backed UI only (no mock data in user-visible flows).
5) TYFYS: protect privacy; no client PII/PHI leakage; rep-safe where required.
6) Keep RingCentral automations healthy (AM posts + verification; inbound/outbound SMS guardrails).
7) Keep backups healthy (hourly git autosync; nightly OpenClaw state bundle backups).
8) Maintain change-control: decisions shouldn’t live only in chat—anchor them in memory files.
9) Avoid drift collisions: detect/disable duplicates; minimize overlapping automations + shared state-file clashes.
10) Keep OpenClaw stable (one gateway LaunchAgent per Mac; don’t create competing services/profiles).

## Today’s non-negotiables (courts/school + backups + RC updates)
- Courts/school:
  - Email watch (courts + schools): **7:30am ET** + **4:40pm ET** (draft-only replies).
  - Daily ops scan includes court/school searches (draft-only).
- Backups:
  - Hourly git auto-sync: runs at :05 past the hour.
  - Nightly OpenClaw state bundle backups: Drive + local sync (**2:30am + 2:40am ET**).
- RingCentral (TYFYS):
  - Weekday AM: Morning Sales Team update (8:30), lead buckets (8:32), KPI scoreboard (8:35), verification (8:40).
  - Weekday PM: Day Cap update (**4:00pm ET**).
  - Inbound routing + inbound auto-replies + outbound autopilot run in windows (guardrails in payloads).

## Active workstreams + next actions
### 1) Anchoring / planning hygiene
- Next actions (queued):
  - Create `memory/goals-master.md` (canonical goals + deadlines).
  - Create `memory/2026-02-16.md` (retro-log + plan), OR update any cron payload(s) that reference it to a canonical existing date file.

### 2) LabStudio (member-usable E2E)
- Work blocks are scheduled weekdays (11am / 2pm / 5pm ET).
- Next action: keep progress PR-oriented (branch + small commits + `pnpm build`) and avoid prod deploy unless explicitly approved.

### 3) TYFYS automations (Zoho + RingCentral)
- Next action: watch for token/auth failures (`invalid_grant`) and fix via per-user RC refresh script when needed.
- Keep Jared excluded where payload says excluded (token/extension mismatch) to avoid noisy failures.

### 4) DriftGuard / repo hygiene
- Next action: if any cron/automation edits happen via UI, ensure they get written back into this file (so nothing lives only in chat).

## Cron health (quick scan)
Enabled jobs with `lastStatus=error` in the last ~24h:
- `786870c7-a69b-426c-bd29-3dad3f438003` — **TYFYS inbound SMS auto-reply scanner (Sales team)**
  - lastError: `Error: cron: job execution timed out` (consecutiveErrors=1)

Notes:
- Several *disabled* historical one-shot jobs show `Unsupported channel: whatsapp` in lastError. Low priority unless re-enabled.

## Detected breakages + queued fix (do next available work block)
1) **Missing anchor inputs**: `goals-master.md` and `2026-02-16.md` paths don’t exist.
   - Fix (queued): create those files (preferred) OR change any jobs that read them to point at canonical files.
2) **Inbound auto-reply scanner timing out**.
   - Fix (queued): reduce scan scope (shorter lookback / fewer lines), ensure script early-exits, and/or bump `timeoutSeconds` for this job.
3) **Old disabled one-shot deliveries misrouted** (`Unsupported channel: whatsapp`).
   - Fix (queued, low priority): delete old one-shots or ensure any future one-shots explicitly set `delivery.channel=telegram`.
