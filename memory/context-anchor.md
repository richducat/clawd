# Context Anchor (internal)

Last updated: 2026-02-19 01:02 ET

## Source reads (internal summary)
- ⚠️ Missing files (not found on disk):
  - `/Users/richardducat/clawd/memory/goals-master.md`
  - `/Users/richardducat/clawd/memory/2026-02-16.md`
- Read:
  - `MEMORY.md` (skim: operating rules / non-negotiables)
  - `memory/context-anchor.md` (prior anchor)

### MEMORY.md skim — operating rules / non-negotiables
- **Outbound comms:** draft-first for *all* outbound emails until explicit approval to send.
- **Karen:** do not email Karen back automatically (draft-only; wait for explicit approval).
- **Autonomy + friction:** be proactive; if ≥70% sure and safe/reversible, decide and proceed; only ask when safety/permissions/irreversibility or likely costly mistake.
- **Code/work:** PR-sized changes; do not push live; Richard tests/commits.
- **LabStudio:** **NO mock data** in user-visible UI (real DB/integration-backed data only).
- **OpenClaw dual-Mac:** one LaunchAgent per Mac; don’t copy `~/.openclaw*`; office uses `--profile office`.

## Top 10 commitments (current operating commitments)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically (draft-only; approval required).
3) Ship one tangible, testable deliverable on a steady cadence; keep it PR-sized; write PR drafts.
4) LabStudio: real DB/integration-backed UI only (no mock data).
5) TYFYS: protect privacy (no client PII/PHI leakage; rep-safe where required).
6) Keep RingCentral automations healthy (AM posts + verification + ops brief).
7) Keep backups healthy (hourly git autosync; nightly OpenClaw state backups).
8) Maintain change-control: key decisions shouldn’t live only in chat—anchor in memory files.
9) Avoid drift collisions: detect/disable duplicates; minimize overlapping automations.
10) Maintain “Devin visibility” loop (daily client status updates for stages 1–3).

## Today’s non-negotiables (Thu Feb 19)
- Courts/school:
  - Keep the scheduled email watches running; any replies are **draft-only**.
- Backups:
  - Hourly git auto-sync job must stay green.
  - Nightly OpenClaw state backups (Drive + local sync) must stay green.
- RingCentral / TYFYS updates:
  - Weekday AM sequence (sales update + lead buckets + KPI + verification).
  - Ops brief (Mon–Sat 6pm ET).
  - Client status posts to Devin group (AM 9:00 ET + EOD 6:00 ET).

## Active workstreams + next actions
### 1) TYFYS — Veteran Files → Zoho Deal attachments backfill
- Status (from last known run): processed 107 folders; matched 81 deals; uploaded 203 new attachments; 1,084 skipped duplicates; 26 unmatched; 43 failures mostly `.gdoc` hydration.
- Next actions:
  - Handle `.gdoc` placeholders (export to real PDF/DOCX or explicitly skip) and rerun “errors-only”.
  - Resolve 26 unmatched folders (improve matching heuristic + maintain manual mapping list).
  - Keep report current: `memory/tyfys/veteran-files-attach-report.json`.

### 2) TYFYS — Intake notes gap / deal-file-health tooling
- Problem: intake calls appear completed but intake notes missing in Zoho.
- Next actions:
  - Use `scripts/tyfys/deal-file-health.mjs` to flag `⚠️MISSING_INTAKE_NOTES` and push a focused “top at-risk” list to Devin group.

### 3) VoltGuard — homepage lead capture
- Status: wizard replaced with Tailwind lead form wired to Google Form; deployed to GitHub Pages.
- Next actions:
  - Verify live submissions land in the Google Sheet.
  - Optional: minimal validation + phone formatting.

### 4) LabStudio
- Next actions:
  - Continue incremental “member usable end-to-end” work (cafe + booking + shop/cart/checkout).
  - Guardrails: no prod deploy without explicit approval.

### 5) OpenClaw reliability (dual-Mac)
- Next actions:
  - Preserve rules: office uses `--profile office`; one LaunchAgent per Mac; never sync `~/.openclaw*`.

### 6) PersonaPlex disk fix
- Next actions:
  - Increase pod disk (40–60GB) OR move HF cache to a larger mount and restart server.

## Cron health (quick)
- Check time: 2026-02-19 01:02 ET
- Jobs with `lastStatus=error` seen on scheduler:
  - All observed errors are on **disabled / delete-after-run** one-shots (historical), with `lastError: Unsupported channel: whatsapp`.
  - No enabled recurring jobs currently show `lastStatus=error` or `consecutiveErrors>0`.

## Detected breakages + queued fix (do NOT execute now)
1) **Missing anchor inputs**: `goals-master.md` and `2026-02-16.md` don’t exist.
   - Fix next work block:
     - Create `memory/goals-master.md` (seed: top goals + deadlines + non-negotiables).
     - Reconstruct `memory/2026-02-16.md` (retro-log + next-day plan) OR update automation references to the correct canonical daily file(s).
2) **One-shot cron deliveries misrouted (whatsapp)** (disabled jobs).
   - Fix next work block (low priority since disabled): clean up/delete old one-shots; ensure future one-shots set `delivery.channel=telegram` explicitly.
