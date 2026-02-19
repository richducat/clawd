# Context Anchor (internal)

Last updated: 2026-02-19 06:02 ET

## Source reads (internal summary)
- ⚠️ Missing files (not found on disk):
  - `/Users/richardducat/clawd/memory/goals-master.md`
  - `/Users/richardducat/clawd/memory/2026-02-16.md`
- Read/checked:
  - `MEMORY.md` (skim: operating rules / non-negotiables)
  - `memory/context-anchor.md` (previous anchor state)
  - `cron list` (health scan)

### MEMORY.md skim — operating rules / non-negotiables
- **Outbound comms:** draft-first for *all* outbound emails until explicit approval to send.
- **Karen:** do not email Karen back automatically (draft-only; approval required).
- **Autonomy + friction:** if ≥70% sure and safe/reversible, decide and proceed; only ask when safety/permissions/irreversibility or likely costly mistake.
- **Code/work:** PR-sized changes; do not push live; Richard tests/commits.
- **LabStudio:** **NO mock data** in user-visible UI (real DB/integration-backed data only).

## Top 10 commitments (bullets)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically; draft-only + wait for explicit approval.
3) Never blindly respond: review the thread context before drafting.
4) Avoid friction: if ≥70% sure and safe, proceed without clarifying questions.
5) Ship tangible, testable deliverables steadily; keep PR-sized; include test steps + risk/rollback.
6) LabStudio: no mock data in user-visible UI—only real DB/integration data.
7) TYFYS: protect privacy (no client PII/PHI leakage; rep-safe summaries where required).
8) Keep RingCentral automations healthy (AM posts + verification; inbound/outbound SMS guardrails).
9) Keep backups healthy (hourly git autosync; nightly OpenClaw state backups).
10) Change-control discipline: decisions/automation changes must be anchored in memory files (not just chat/UI).

## Today’s non-negotiables (Thu Feb 19)
### Courts / School
- Keep scheduled court/school email watches running.
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
- Devin visibility posts:
  - 9:00am “Morning client status (stages 1–3)”
  - 6:00pm “Evening client status (stages 1–3)”

## Active workstreams + next actions
### 1) Anchor hygiene (meta)
- Breakage: automations reference files that don’t exist.
- Next actions (next available work block):
  - Create `memory/goals-master.md` (canonical goals + deadlines + recurring non-negotiables).
  - Reconstruct `memory/2026-02-16.md` (retro-log) **or** update automation references to point at an existing daily log.

### 2) TYFYS — Veteran Files → Zoho Deal attachments backfill
- Current status (from last known anchor):
  - processed folders(with files)=107; matched deals=81; candidates examined=1,330; uploaded=203; skipped(already attached by filename)=1,084; unmatched folders=26; failures=43 (mostly `.gdoc` hydration/export issue).
- Next actions:
  - Add explicit `.gdoc` handling (export to real PDF/DOCX or skip with clear reason) and re-run **errors-only**.
  - Resolve 26 unmatched folders (improve matching heuristics + maintain manual mapping list).
  - Keep report current: `memory/tyfys/veteran-files-attach-report.json`.

### 3) TYFYS — Intake notes gap / deal-file-health
- Problem: intake calls appear completed but intake notes missing in Zoho.
- Next actions:
  - Re-run `deal-file-health` focusing on first 3 stages; ensure Devin-group summaries remain accurate.
  - Process alignment: when missing notes detected → create/assign follow-up task (owner depends on stage).

### 4) VoltGuard — homepage lead capture
- Status: homepage lead form posts to Google Form endpoint; deployed to GitHub Pages (commit `7459bc3`).
- Next actions:
  - Confirm submissions land in the Google Sheet.
  - Add basic client-side validation + friendly success state (no PII logging).

### 5) LabStudio
- Goal: member-usable end-to-end (cafe + booking + shop/cart/checkout).
- Next actions:
  - Continue incremental flow work on a feature branch; keep PR-sized.
  - **No prod deploy** without explicit approval.

### 6) PersonaPlex disk fix
- Next actions:
  - Increase pod disk to ~40–60GB **or** move HF cache to larger mount (`HF_HOME`/`HF_HUB_CACHE`) and restart server.

### 7) OpenClaw dual-Mac stability
- Keep office vs travel profiles separated.
- Next actions (as needed): validate only one gateway LaunchAgent per Mac + `gateway.mode=local` on office profile.

## Cron health (quick)
- Check time: 2026-02-19 06:02 ET
- Jobs with `lastStatus=error` whose `lastRunAtMs` falls within the last ~24h:
  - None detected.

## Detected breakages + the fix to apply next (queue only; do not execute now)
1) **Missing anchor inputs**: `goals-master.md` and `2026-02-16.md` don’t exist.
   - Fix next work block:
     - Create `memory/goals-master.md`.
     - Reconstruct `memory/2026-02-16.md` or repoint the context-anchor + daily goals cron payload to existing files.
2) **Context anchor cron job risk** (enabled): missing files + 180s timeout could cause future anchor runs to fail if reads are re-enabled.
   - Fix next work block:
     - After creating/repointing files, trigger `cron run` once to confirm green.
     - If still timing out, reduce scope (fewer reads) and/or extend timeout to 300s.
3) **Historical one-shot cron deliveries misrouted (whatsapp)** (disabled jobs; non-urgent).
   - Fix next work block (low priority): delete old one-shots or ensure future one-shots always set `delivery.channel=telegram` explicitly.
