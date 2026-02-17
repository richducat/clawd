# Context Anchor (internal)

Last updated: 2026-02-16 19:02 ET

## 1) Internal summaries (quick)

### goals-master.md (expected)
- Missing: `/Users/richardducat/clawd/memory/goals-master.md` (ENOENT).
- Action queued: create this file with quarterly goals + active commitments so the daily goals cron + this anchor can work.

### Daily log 2026-02-16 (expected)
- Missing: `/Users/richardducat/clawd/memory/2026-02-16.md` (ENOENT).
- Closest context: `2026-02-15.md` focuses on OpenClaw dual-Mac stabilization (office profile + travel profile separation).
- Action queued: create `2026-02-16.md` and capture today’s key decisions + LabStudio/TYFYS status.

### MEMORY.md (skim — operating rules / non-negotiables)
- Draft-first for ALL outbound emails until explicitly approved to send; do NOT email Karen back.
- Avoid friction: if ≥70% sure, decide and proceed without clarifying questions (unless safety/permissions/irreversible/costly).
- LabStudio: NO mock data in user-visible UI (real DB/integration only).
- For code changes: PR-sized, don’t push live; Richard tests/commits.

## 2) Top 10 commitments (keep front-of-mind)
1) Draft-first outbound comms (no sending without explicit approval).
2) Never email Karen back (draft-only; or route via Richard).
3) Keep TYFYS ops moving: reduce lead staleness + improve throughput/revenue.
4) Maintain RC automations reliability (morning posts, lead buckets, KPI scoreboard, inbound scanners).
5) Court/school vigilance (Gmail watches + deadline capture).
6) Kids support: Berkeley speech practice + Everett soccer support/check-ins.
7) LabStudio: ship real, end-to-end member flows (no mock data) and keep changes PR-sized.
8) Backups are sacred: hourly git auto-sync + nightly OpenClaw state backup.
9) OpenClaw stability: dual-Mac separation; one gateway LaunchAgent per Mac; don’t copy ~/.openclaw*.
10) Change-control: when automation/ops changes, record it in an anchor file so it doesn’t live only in chat.

## 3) Today’s non-negotiables (courts/school + backups + RC updates)

### Courts / School
- Email watch (courts + schools): 7:30am ET + 4:40pm ET (runs via cron).
- Daily 6am ops inbox/transcripts scan: runs via cron.

### Backups
- Hourly: git auto-sync all repos (cron `d43e5f81-...`, 5 min past the hour).
- Nightly: OpenClaw state bundle → Drive (2:30am ET) + local Drive sync (2:40am ET).

### RingCentral (TYFYS) updates
- Weekdays: Morning sales team update (8:30am), lead buckets (8:32am), KPI scoreboard (8:35am), verification (8:40am), day-cap (4:00pm).
- Mon–Sat: TYFYS Ops Brief reminder at 8pm ET (REP-SAFE posting step).
- Throughout windows: inbound SMS scanner + outbound autopilot + inbound forward-to-owner.

## 4) Active workstreams + next actions

### A) LabStudio
- Active: deploy branch `feat/2026-02-16-labstudio-shop-on-prod-baseline` once Vercel quota resets.
- Next action: when the scheduled deploy job fires (today ~9:55pm ET), run deploy steps + smoke check `/members` nav + Shop visibility.

### B) TYFYS automations / throughput
- Keep an eye on RC token files churn:
  - `memory/ringcentral-token.json` and `memory/ringcentral-token.new.json` both exist (potential drift).
- Next action: during next work block, verify which token file is actually used by scripts; consolidate to one canonical path and update scripts/docs accordingly (small PR).

### C) OpenClaw stability / driftguard
- Active: dual-Mac separation rules (office profile vs travel).
- Next action: ensure no new LaunchAgents on either Mac; verify `openclaw --profile office gateway probe` when convenient.

## 5) Detected breakages + queued fixes

### Missing anchors
- BREAK: `memory/goals-master.md` missing → affects daily-goals cron usefulness.
  - Fix next block: create file with (1) quarterly goals, (2) standing commitments, (3) active workstreams.
- BREAK: `memory/2026-02-16.md` missing.
  - Fix next block: create file and capture today’s decisions/status.

### Cron health (last 24h)
- No ENABLED jobs observed with `lastStatus=error` in the cron list snapshot.
- NOTE: Several DISABLED one-shot Telegram-topic jobs (Feb 14) show `lastStatus=error` with `Unsupported channel: whatsapp`.
  - Likely cause: delivery config missing/incorrect channel routing.
  - Fix next block: audit those job definitions; set `delivery.channel="telegram"` (or remove delivery/channel so default routes correctly) and re-test with a safe non-personal message.
