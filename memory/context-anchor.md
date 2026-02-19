# Context Anchor (internal)

Last updated: 2026-02-19 02:02 ET

## Source reads (internal summary)
- ⚠️ Missing files (not found on disk):
  - `/Users/richardducat/clawd/memory/goals-master.md`
  - `/Users/richardducat/clawd/memory/2026-02-16.md`
- Read:
  - `MEMORY.md` (skim: operating rules / non-negotiables)
  - `memory/2026-02-18.md` (latest substantive daily log)
  - `memory/context-anchor.md` (prior anchor)

### MEMORY.md skim — operating rules / non-negotiables
- **Outbound comms:** draft-first for *all* outbound emails until explicit approval to send.
- **Karen:** do not email Karen back automatically (draft-only; approval required).
- **Autonomy + friction:** if ≥70% sure and safe/reversible, decide and proceed; only ask when safety/permissions/irreversibility or likely costly mistake.
- **Code/work:** PR-sized changes; do not push live; Richard tests/commits.
- **LabStudio:** **NO mock data** in user-visible UI (real DB/integration-backed data only).
- **OpenClaw dual-Mac:** one LaunchAgent per Mac; don’t copy `~/.openclaw*`; office uses `--profile office`.

## Top 10 commitments (bullets)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically; draft-only + wait for explicit approval.
3) Ship tangible, testable deliverables on a steady cadence; keep them PR-sized; write PR drafts + test steps.
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
### 1) TYFYS — Veteran Files → Zoho Deal attachments backfill
- Status (last pass 2026-02-18): processed 107 folders; matched 81 deals; examined 1,330 files; uploaded 203 new attachments; skipped 1,084 duplicates; 26 unmatched; 43 failures.
- Main failure mode: `.gdoc` placeholder files causing hydration/read errors ("Unknown system error -11").
- Next actions:
  - Add explicit `.gdoc` handling (export to real PDF/DOCX or skip with a clear reason), then rerun errors-only.
  - Resolve 26 unmatched folders (improve matching heuristics + maintain a manual mapping list).
  - Keep report current: `memory/tyfys/veteran-files-attach-report.json`.

### 2) TYFYS — Intake notes gap / deal-file-health
- Problem: intake calls appear completed but intake notes missing in Zoho.
- Tooling shipped: `scripts/tyfys/deal-file-health.mjs` flags `⚠️MISSING_INTAKE_NOTES`.
- Next actions:
  - Re-run deal-file-health focusing on first 3 stages; keep Devin group visibility loop intact.
  - Align process: if missing notes detected → create/assign follow-up task (don’t silently leave gaps).

### 3) VoltGuard — homepage lead capture
- Status: homepage form → Google Form wired and deployed (commit `7459bc3`).
- Next actions:
  - Verify live submissions landing in Google Sheet.
  - Optional: minimal validation + phone formatting.

### 4) LabStudio
- Goal: member-usable end-to-end (cafe + booking + shop/cart/checkout).
- Next actions:
  - Continue incremental flow work on a feature branch; keep PR-sized.
  - **No prod deploy** without explicit approval.

### 5) PersonaPlex disk fix
- State: server works but GPU pod ran out of disk while downloading `model.safetensors`.
- Next actions:
  - Increase pod disk to 40–60GB **or** move HF cache to a larger mount (`HF_HOME`/`HF_HUB_CACHE`) and restart server.

## Cron health (quick)
- Check time: 2026-02-19 02:02 ET
- Jobs with `lastStatus=error` in last 24h:
  - None found among enabled recurring jobs.
- Noted (older/historical): several **disabled / delete-after-run** one-shots show `Unsupported channel: whatsapp` errors; these should not recur but are worth cleaning up.

## Detected breakages + queued fix (do NOT execute now)
1) **Missing anchor inputs**: `goals-master.md` and `2026-02-16.md` don’t exist.
   - Fix next work block:
     - Create `memory/goals-master.md` (seed: top goals, deadlines, recurring non-negotiables).
     - Reconstruct `memory/2026-02-16.md` (retro-log) **or** update automation references to point at the correct canonical daily file(s).
2) **Historical one-shot cron deliveries misrouted (whatsapp)** (disabled jobs).
   - Fix next work block (low priority): delete old one-shots or normalize future one-shots to explicit `delivery.channel=telegram` to prevent repeats.
