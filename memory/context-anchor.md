# Context Anchor — 2026-02-16 20:02 ET

## Inputs read (this run)
- ✅ `/Users/richardducat/clawd/MEMORY.md` (skim: operating rules + non‑negotiables)
- ❌ `/Users/richardducat/clawd/memory/goals-master.md` **missing** (ENOENT)
- ❌ `/Users/richardducat/clawd/memory/2026-02-16.md` **missing** (ENOENT)

## Top 10 commitments (do-not-drift)
1) **Draft-first outbound comms**: do not send emails/messages unless explicitly approved.
2) **Do NOT email Karen back** (even simple replies) — draft-only.
3) **Autonomy + low friction**: if ≥70% sure and safe/reversible, decide and proceed; only ask when safety/permissions/irreversibility or high cost.
4) **Progress cadence**: <10 min tasks → update every 1 min; ≥10 min → every 3 min + at milestones/blocks.
5) **LabStudio UI rule**: **NO mock data** in user-visible UI; only real DB/integration-backed.
6) **LabStudio shipping style**: PR-sized (<400 lines net), test steps + risk/rollback + security/PII/PHI check; do not deploy to prod without explicit approval.
7) **OpenClaw dual-MBP hygiene**: never copy/sync `~/.openclaw*` between Macs; one gateway LaunchAgent per Mac; office profile uses `gateway.mode=local`.
8) **Daily monitoring**: courts + school email watch (personal) and provider replies watch (TYFYS) stay working.
9) **RC sales automation**: morning/lead buckets/KPI/day-cap/ops brief posts must stay reliable + rep-safe.
10) **Backups**: hourly git auto-sync + nightly OpenClaw state backup to Drive + local sync.

## Today’s non-negotiables (Mon Feb 16)
(Note: the intended authoritative “today plan” file is missing; this is the standing non-negotiables set.)
- **Courts/school**: email watch jobs must be healthy (AM + PM). If errors, fix gog auth/search and rerun.
- **Backups**:
  - Hourly: `scripts/backup/git-auto-sync-all.sh` job must keep succeeding.
  - Nightly: OpenClaw state bundle backups (Drive + local sync) must keep succeeding.
- **RC updates** (weekdays): morning sales team update, lead buckets, KPI scoreboard, day-cap update, and nightly ops brief (rep-safe) should run + post.

## Active workstreams + next actions
### TYFYS (throughput + revenue)
- Automations running:
  - inbound SMS auto-reply scanner
  - outbound SMS autopilot
  - inbound SMS forward-to-owner
  - RC morning/lead buckets/KPI/day-cap posts
  - provider replies watch
- Next actions (next work block):
  - Verify no state-file collisions across SMS jobs (each job references a distinct `memory/*.json`; confirm no accidental overlap when editing).
  - **Fix copy mismatch**: “TYFYS Ops Brief (Mon-Sat 8pm ET)” job schedule is `0 18 * * 1-6` (= **6pm ET**). Align job name + payload text to schedule (or adjust schedule if 8pm was intended).

### LabStudio (member usable end-to-end)
- Non-negotiable: no mock data.
- Next actions (next work block):
  - Continue latest LabStudio PR/branch toward real shop/cart/checkout.
  - Prepare for scheduled deploy job `e69a0b5d...` (2026-02-17 02:55Z) once Vercel quota resets; ensure branch builds locally before deploy.

### OpenClaw / DriftGuard
- Next actions:
  - Keep DriftGuard cron error sentinel quiet (only alert on enabled failures).
  - Any legacy jobs referencing WhatsApp delivery should remain disabled; if resurrected, ensure delivery targets a supported channel.

## Cron health (quick)
- Enabled jobs: **no `lastStatus=error` observed** in the current cron list.
- Last-24h errors: **none detected** among enabled jobs.

## Detected breakages + queued fix (do not execute now)
1) **Missing goals master**: `/Users/richardducat/clawd/memory/goals-master.md` not found.
   - Evidence: `find ... -iname goals-master.md` returned nothing.
   - Fix next: recreate a minimal `goals-master.md` (top business + personal priorities + weekly cadence) from (a) MEMORY.md operating rules, (b) active cron obligations, (c) current repos/workstreams.
2) **Missing daily log**: `/Users/richardducat/clawd/memory/2026-02-16.md` not found.
   - Fix next: create the file and backfill today’s key events/decisions from (a) cron job changes, (b) git log last 24h, (c) any notable automation updates.
3) **Ops Brief time mismatch (copy)**: job name says “8pm ET” but schedule is **6pm ET**.
   - Fix next: patch cron job name + payload text to match schedule (lowest risk).