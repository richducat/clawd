# Context Anchor (internal)

Last updated: 2026-02-19 00:02 ET

## Source reads (internal summary)
- ⚠️ Missing files (still not found on disk):
  - `/Users/richardducat/clawd/memory/goals-master.md`
  - `/Users/richardducat/clawd/memory/2026-02-16.md`
- Read:
  - `MEMORY.md` (skim: operating rules / non-negotiables)
  - `memory/context-anchor.md` (prior anchor)
  - `memory/2026-02-18.md` (as summarized in prior anchor)
- MEMORY.md skim (operating rules / non-negotiables):
  - Draft-first for *all* outbound emails until explicitly approved to send.
  - **Do not email Karen back automatically** (draft-only; no sending without explicit approval).
  - Be proactive + low-friction: if ≥70% sure and safe/reversible, decide and proceed.
  - For code/work: PR-sized changes; do not push live; Richard tests/commits.
  - LabStudio: **NO mock data** in user-visible UI (real DB/integration backed).
  - OpenClaw dual-Mac rules: one LaunchAgent per Mac; don’t copy `~/.openclaw*`; office uses `--profile office`.

## Top 10 commitments (current operating commitments)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically (draft-only; wait for approval).
3) Ship one tangible, testable deliverable (PR-sized) on a steady cadence; write PR drafts.
4) LabStudio: real DB/integration-backed UI only (no mock data).
5) TYFYS: protect privacy (no client PII/PHI leakage; rep-safe where required).
6) Keep RingCentral automations healthy (AM posts + verification + ops brief).
7) Keep backups healthy (hourly git autosync; nightly OpenClaw state backups).
8) Maintain change-control: decisions shouldn’t live only in chat—anchor in memory files.
9) Avoid drift collisions: detect/disable duplicates; minimize overlapping automations.
10) Keep the “Devin visibility” loop healthy (daily client status posts for stages 1–3).

## Today’s non-negotiables (Thu Feb 19)
- Courts/school watch:
  - Morning + afternoon email scans (draft-only replies; no sending without approval).
- Backups:
  - Hourly git auto-sync ✅ enabled (job `d43e5f81-...`)
  - Nightly OpenClaw state backups to Drive + local sync ✅ enabled (`188a18be-...`, `854bc3fc-...`)
- RingCentral updates:
  - Weekday AM sequence (sales update + lead buckets + KPI + verification) ✅ enabled
  - Ops brief (Mon–Sat 6pm ET) ✅ enabled
- RC/TYFYS “stage health” updates to Devin group:
  - Morning 9:00 ET ✅ enabled (`0b3dcb20-...`)
  - Evening 6:00 ET ✅ enabled (`db970782-...`)

## Active workstreams + next actions
### 1) TYFYS — Veteran Files → Zoho Deal attachments backfill
- Current status (from 2026-02-18 run): processed 107 folders; matched 81 deals; uploaded 203 new attachments; 1,084 skipped duplicates; 26 unmatched; 43 failures mostly `.gdoc` hydration.
- Next actions:
  - Handle `.gdoc` placeholders (export to real PDF/DOCX or explicitly skip) and rerun “errors-only”.
  - Resolve 26 unmatched folders (improve matching heuristic + manual mapping list).
  - Keep report current: `memory/tyfys/veteran-files-attach-report.json`.

### 2) TYFYS — Intake notes gap / deal-file-health tooling
- Problem: intake calls appear completed but intake notes missing in Zoho.
- Next actions:
  - Use `scripts/tyfys/deal-file-health.mjs` to flag `⚠️MISSING_INTAKE_NOTES` and push a focused “top at-risk” list to Devin group.
  - Branch delivered (per prior anchor): `chore/2026-02-18-deal-health-intake-notes` + PR draft `PR_DRAFT_2026-02-18_deal-health-intake-notes.md`.

### 3) VoltGuard — homepage lead capture
- Status: wizard replaced with Tailwind lead form wired to Google Form; deployed to GitHub Pages (commit `7459bc3`).
- Next actions:
  - Verify live submissions land in the Google Sheet (no-cors means we don’t get response; validate by checking sheet).
  - Optional: add minimal validation + phone formatting.

### 4) LabStudio
- Next actions:
  - Continue incremental “member usable end-to-end” work (cafe + booking + shop/cart/checkout).
  - Guardrails: no prod deploy without explicit approval.

### 5) OpenClaw reliability (dual-Mac)
- Next actions:
  - Preserve rules: office uses `--profile office`; one LaunchAgent per Mac; never sync `~/.openclaw*`.

### 6) PersonaPlex disk fix (reminder set for later today)
- Next actions:
  - Increase pod disk (40–60GB) OR move HF cache to a larger mount and restart server.

## Cron health (quick)
- Enabled jobs with `lastStatus=error` in last 24h: **none detected**.
- Errors present but on **disabled** historical one-shots:
  - Several “Cool Cat test ping” jobs + one LabStudio deploy one-shot show `lastError: Unsupported channel: whatsapp`.

## Detected breakages + queued fix (do NOT execute now)
1) **Missing anchor inputs**: `goals-master.md` and `2026-02-16.md` don’t exist.
   - Fix next work block:
     - Create `memory/goals-master.md` (seed: top goals + deadlines + “don’t forget” obligations).
     - Create `memory/2026-02-16.md` (retro-log + next-day plan) OR update automations that reference it to the canonical daily file(s).
2) **One-shot cron deliveries misrouted (whatsapp)** (disabled jobs).
   - Fix next work block (low priority since disabled): clean up/delete old one-shots; ensure future one-shots set delivery.channel=`telegram` explicitly (verify cron UI defaults).
