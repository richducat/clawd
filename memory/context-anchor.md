# Context Anchor (internal)

Last updated: 2026-02-19 03:02 ET

## Source reads (internal summary)
- ⚠️ Missing files (not found on disk):
  - `/Users/richardducat/clawd/memory/goals-master.md`
  - `/Users/richardducat/clawd/memory/2026-02-16.md`
- Read:
  - `MEMORY.md` (skim: operating rules / non-negotiables)
  - `memory/2026-02-18.md`
  - `memory/context-anchor.md` (prior anchor)
  - `cron list` (health scan)
  - `ls memory/` to verify what exists

### MEMORY.md skim — operating rules / non-negotiables
- **Outbound comms:** draft-first for *all* outbound emails until explicit approval to send.
- **Karen:** do not email Karen back automatically (draft-only; approval required).
- **Autonomy + friction:** if ≥70% sure and safe/reversible, decide and proceed; only ask when safety/permissions/irreversibility or likely costly mistake.
- **Code/work:** PR-sized changes; do not push live; Richard tests/commits.
- **LabStudio:** **NO mock data** in user-visible UI (real DB/integration-backed data only).

## Top 10 commitments (bullets)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically; draft-only + wait for explicit approval.
3) Ship tangible, testable deliverables steadily; keep PR-sized; write PR drafts + test steps.
4) LabStudio: no mock data in user-visible UI—only real DB/integration data.
5) TYFYS: protect privacy (no client PII/PHI leakage; rep-safe summaries where required).
6) Keep RingCentral automations healthy (AM posts + verification; inbound/outbound SMS guardrails).
7) Keep backups healthy (hourly git autosync; nightly OpenClaw state backups).
8) Change-control discipline: decisions/automation changes must be anchored in memory files (not just chat/UI).
9) Avoid drift collisions: detect/disable duplicates; minimize overlapping automations.
10) Maintain “Devin visibility” loop (daily stages 1–3 client status updates to Devin group).

## Today’s non-negotiables (Thu Feb 19)
### Courts / School
- Keep scheduled email watches running.
- Any needed replies are **DRAFT ONLY**.

### Backups
- Hourly git auto-sync must stay green.
- Nightly OpenClaw state backups (Drive + local sync) must stay green.

### RingCentral / RC updates (TYFYS)
- Weekday AM sequence must run clean:
  - 8:30am Morning Sales Team RC Update
  - 8:32 lead buckets
  - 8:35 KPI scoreboard
  - 8:40 verification (dry-run sanity)
- 6pm Ops Brief (Mon–Sat).
- Devin group posts:
  - 9:00am “Morning client status (stages 1–3)”
  - 6:00pm “Evening client status (stages 1–3)”

## Active workstreams + next actions
### 1) Anchor hygiene (meta)
- Breakage: cron + routines reference files that don’t exist.
- Next actions (next work block):
  - Create `memory/goals-master.md` (canonical goals + deadlines + recurring non-negotiables).
  - Reconstruct `memory/2026-02-16.md` (retro-log) **or** update any references to point at existing daily logs.

### 2) TYFYS — Veteran Files → Zoho Deal attachments backfill
- Status (2026-02-18 log):
  - processed folders(with files)=107
  - matched to Zoho Deals=81
  - attachment candidates examined=1,330
  - new attachments uploaded=203
  - skipped (already-attached by exact filename)=1,084
  - unmatched folders remaining=26
  - failures=43 (mostly `.gdoc` hydration/export issue)
- Next actions:
  - Add explicit `.gdoc` handling (export to real PDF/DOCX or skip with clear reason) and re-run errors-only.
  - Resolve 26 unmatched folders (improve matching heuristics + maintain a manual mapping list).
  - Keep report current: `memory/tyfys/veteran-files-attach-report.json`.

### 3) TYFYS — Intake notes gap / deal-file-health
- Problem: intake calls appear completed but intake notes missing in Zoho.
- Tooling shipped (2026-02-18): `scripts/tyfys/deal-file-health.mjs` flags `⚠️MISSING_INTAKE_NOTES`.
- Next actions:
  - Re-run deal-file-health focusing on first 3 stages; ensure Devin-group summaries stay accurate.
  - Process alignment: missing notes detected → create/assign follow-up task.

### 4) VoltGuard — homepage lead capture
- Status (2026-02-18): replaced homepage wizard with Tailwind lead form and wired to Google Form `formResponse` endpoint; deployed via GitHub Pages (commit `7459bc3`).
- Next actions:
  - Confirm submissions are landing in the Google Sheet (sanity: name/email/phone + details field).
  - Add basic client-side validation + friendly success state (no PII logging).

### 5) LabStudio
- Goal: member-usable end-to-end (cafe + booking + shop/cart/checkout).
- Next actions:
  - Continue incremental flow work on a feature branch; keep PR-sized.
  - **No prod deploy** without explicit approval.

### 6) PersonaPlex disk fix
- State: server works but GPU pod ran out of disk while downloading `model.safetensors`.
- Next actions:
  - Increase pod disk to 40–60GB **or** move HF cache to larger mount (`HF_HOME`/`HF_HUB_CACHE`) and restart server.

## Cron health (quick)
- Check time: 2026-02-19 03:02 ET
- Jobs with `lastStatus=error` in last ~24h: **none detected**.
- Notes:
  - Several historical one-shot / disabled jobs show `Unsupported channel: whatsapp` errors (cleanup candidates, but not recurring).

## Detected breakages + queued fix (do NOT execute now)
1) **Missing anchor inputs**: `goals-master.md` and `2026-02-16.md` don’t exist.
   - Fix next work block:
     - Create `memory/goals-master.md`.
     - Reconstruct `memory/2026-02-16.md` or repoint automation references.
2) **Historical one-shot cron deliveries misrouted (whatsapp)** (disabled jobs).
   - Fix next work block (low priority): delete old one-shots or ensure future one-shots always specify `delivery.channel=telegram`.
