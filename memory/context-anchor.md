# Context Anchor (internal)

Last updated: 2026-02-18 13:02 ET

## Internal summaries (for drift prevention)

### goals-master.md
- **MISSING FILE**: `/Users/richardducat/clawd/memory/goals-master.md` not found (ENOENT).
- Impact: daily goals/deadlines cron (`2254c296-...`) expects this file; content is currently unknown from this anchor run.

### memory/2026-02-16.md
- **MISSING FILE**: `/Users/richardducat/clawd/memory/2026-02-16.md` not found (ENOENT).
- Impact: loss of continuity for decisions/next steps recorded that day.

### MEMORY.md (skim — operating rules + non‑negotiables)
- Operate proactively; default to acting without asking unless safety/permissions/irreversibility.
- Draft-first for **all outbound emails** until explicitly approved to send.
- **Do not email Karen back** (draft-only; no direct send).
- LabStudio: **NO mock data** in user-visible UI (real DB/integration-backed only).
- Deploy/runbook notes exist; Vercel CLI gotchas (git author must match team member email).
- Dual MacBooks/OpenClaw: keep office vs travel profiles separate; never copy `~/.openclaw*`; one LaunchAgent per Mac.

---

## Top 10 commitments (current)
1) **Draft-first** for outbound email; never send without approval.
2) **Do not email Karen back** (ever; drafts ok).
3) **Reduce friction**: if ≥70% sure, decide and proceed.
4) **Protect privacy**: avoid client PII/PHI in outputs; keep rep updates REP-SAFE.
5) **Courts + school vigilance**: daily email watches + surfacing deadlines.
6) **Backups**: hourly git auto-sync + nightly OpenClaw state backups.
7) **TYFYS operations automation**: SMS autopilot, inbound scanners/forwarders, waiting-room check-ins.
8) **RingCentral updates**: AM posts + lead buckets + KPI scoreboard + EOD/day-cap update.
9) **LabStudio progress**: autonomous build blocks; PR-sized changes; no prod deploy without explicit approval.
10) **DriftGuard**: cron error sentinel + preflight/change-control so automations don’t silently fail.

---

## Today’s non-negotiables
- **Courts/School:** keep the 7:30am + 4:40pm email watches clean and reliable; escalate only truly time-sensitive items.
- **Backups:** confirm hourly git auto-sync continues to succeed; nightly OpenClaw bundles should remain green.
- **RC updates:** morning/eod posts and lead freshness buckets must continue posting to the correct RingCentral chat.

---

## Active workstreams + next actions

### A) Reliability / drift prevention
- Next: restore/locate missing anchor files:
  - Find if renamed/moved: search for `goals-master` and `2026-02-16` in `memory/`.
  - If truly absent: recreate minimal versions (placeholders) so dependent jobs stop failing.

### B) TYFYS automations (Zoho + RingCentral)
- Running/enabled: outbound SMS autopilot, inbound auto-reply scanner, inbound forward-to-owner, timezone backfill, waiting-room check-in, provider replies watch.
- Next: keep an eye on OAuth `invalid_grant` errors; refresh per-user tokens only when needed.

### C) LabStudio
- Running/enabled: 11am/2pm/5pm build blocks + progress pings.
- Next: ensure work stays PR-sized; no prod deploy until explicitly approved.

### D) Personal/CRM + comms scans
- Running/enabled: personal CRM ingest + meeting prep; daily comms sweep; EOD update.
- Next: keep outputs short (per job constraints).

---

## Cron health (last 24h: any lastStatus=error)
Observed `lastStatus=error` jobs (may be disabled / one-shots):
- `e69a0b5d-fb54-4b65-ac83-4aad62d55e60` — LabStudio deploy one-shot: **lastError: Unsupported channel: whatsapp** (delivery misroute).

Older (outside 24h) but notable pattern:
- Several Feb 14 one-shots (Everett/Cool Cat pings) errored with **Unsupported channel: whatsapp**.

---

## Detected breakages + queued fix (do not execute now)
1) **Missing files**: `memory/goals-master.md` and `memory/2026-02-16.md`.
   - Fix next work block: locate via ripgrep / filesystem; restore from git history/Drive if applicable; otherwise recreate minimal.
2) **Delivery routing bug**: jobs erroring with `Unsupported channel: whatsapp`.
   - Likely cause: cron delivery config missing/incorrect `channel` (should be telegram) or gateway thinks default channel is whatsapp.
   - Fix next work block: inspect the failing job objects; set explicit `delivery.channel="telegram"` (and `to` where needed) or delete/disable obsolete one-shots.
