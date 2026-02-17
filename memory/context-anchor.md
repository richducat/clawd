# Context Anchor (internal)

Last updated: 2026-02-17 16:02 ET

## Source reads (internal summary)
- ⚠️ Missing files (cron payload references don’t exist in repo):
  - `/Users/richardducat/clawd/memory/goals-master.md` (not found)
  - `/Users/richardducat/clawd/memory/2026-02-16.md` (not found)
- MEMORY.md skim (operating rules / non-negotiables):
  - Draft-first for *all* outbound emails until explicitly approved to send.
  - **Do not email Karen back automatically** (draft-only; never send without explicit approval).
  - Be proactive + low-friction: if ≥70% sure and safe/reversible, decide and proceed.
  - For code/work: PR-sized changes; do not push live; Richard tests/commits.
  - LabStudio: **no mock data** in user-visible UI (real DB/integration-backed only).
  - OpenClaw dual-Mac: one LaunchAgent per Mac; don’t copy `~/.openclaw*`; office uses `--profile office`.
- Daily memory context available:
  - Latest daily log present is `memory/2026-02-15.md` (2026-02-16 missing).

## Top 10 commitments (operating commitments)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically (draft-only; wait for approval).
3) Ship one tangible, testable deliverable (PR-sized) on a steady cadence.
4) LabStudio: real DB/integration-backed UI only (no mock data).
5) TYFYS: protect privacy (no client PII/PHI; rep-safe where required).
6) Keep RingCentral automations healthy (morning posts + verification + ops brief + day-cap).
7) Keep backups healthy (hourly git autosync; nightly OpenClaw state backups).
8) Maintain change-control: decisions shouldn’t live only in chat—anchor in memory files.
9) Avoid drift collisions: detect/disable duplicates; minimize overlapping automations.
10) Keep dual-Mac OpenClaw separation stable (office brain vs travel cockpit).

## Today’s non-negotiables
- Courts/school:
  - Email-watch scans (7:30am + **4:40pm ET**) and draft-only replies.
  - Morning brief prompt (6:00am ET) includes custody + school/courts checks.
- Backups:
  - Hourly git auto-sync ✅ enabled (job `d43e5f81-...`)
  - Nightly OpenClaw state backups → Drive + local sync ✅ enabled (jobs `188a18be-...`, `854bc3fc-...`)
- RingCentral updates:
  - Morning RC posts (8:30/8:32/8:35 + verification 8:40) ✅ enabled (weekdays)
  - **Day-cap RC post (4:00pm ET)** ✅ enabled (weekdays)
  - Ops brief (Mon–Sat 6pm ET) ✅ enabled

## Active workstreams + next actions
### 1) Context anchoring / drift prevention
- Next action (highest): restore canonical source-of-truth files the cron expects.
  - Create `memory/goals-master.md` (top goals + commitments + weekly focus).
  - Create missing daily log `memory/2026-02-16.md` (retro + next-day plan + any decisions).

### 2) LabStudio
- Next action: continue “member-usable end-to-end” build blocks (11am/2pm/5pm jobs).
- Guardrails: PR-sized; do not deploy prod without explicit approval; real data only.

### 3) TYFYS automations
- Next action: keep tokens/state healthy (Zoho token + RC refresh tokens); watch for paging/criteria regressions.

### 4) Backups / hygiene
- Next action: if any repo begins failing auto-sync, fix upstream/branch drift and re-run backup job.

## Cron health quick check (lastStatus=error in last 24h)
- ⚠️ Detected jobs with `lastStatus=error` (may be disabled / one-shot, but still indicates breakage patterns):
  - `e69a0b5d-...` “LabStudio deploy: shop-on-prod-baseline once Vercel quota resets” — lastError: `Unsupported channel: whatsapp` (disabled)
  - `df8f1ae3-...` “Cool Cat test ping” — lastError: `Unsupported channel: whatsapp` (disabled)
  - `464cbf82-...` “Cool Cat test ping retry” — lastError: `Unsupported channel: whatsapp` (disabled)
  - `806bdedf-...` “Cool Cat test ping (now, after permissions fixed)” — lastError: `Unsupported channel: whatsapp` (disabled)
  - `0338f6fa-...` “Everett kickoff: playtest checklist + feedback prompts (Cool Cat)” — lastError: `Unsupported channel: whatsapp` (disabled)

## Detected breakages + queued fix (do not execute now)
1) **Context anchor inputs missing**: `goals-master.md` + `2026-02-16.md` do not exist.
   - Fix next work block: create both files (preferred), and update any other jobs that reference goals-master to the correct canonical path.
2) **Channel mismatch footgun**: multiple jobs show `Unsupported channel: whatsapp`.
   - Fix next work block: audit cron job `delivery` objects + gateway default channel configuration.
   - Ensure jobs intended for Telegram have explicit `delivery.channel="telegram"` (and valid `delivery.to`), and remove/avoid any whatsapp defaults.
