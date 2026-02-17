# Context Anchor (internal)

Last updated: 2026-02-17 18:02 ET

## 1) Source refresh (internal summary)
- **memory/goals-master.md:** MISSING (ENOENT). Breakage: at least one enabled cron job (“Daily goals + deadlines post”) depends on it.
- **memory/2026-02-16.md:** MISSING (ENOENT). Continuity gap for yesterday’s work/decisions.
- **MEMORY.md (skim — operating rules/non‑negotiables):**
  - Draft-first for all outbound comms until explicitly approved.
  - **Do not email Karen back** (draft-only rule persists).
  - Avoid friction: if ≥70% sure, decide and proceed; only ask when safety/permissions/irreversible.
  - LabStudio: **NO mock data** in user-visible UI.
  - OpenClaw dual-Mac: don’t copy `~/.openclaw*`; one LaunchAgent per Mac; office profile uses `~/.openclaw-office` with `gateway.mode=local` + loopback bind.

## 2) Top 10 commitments (current)
1) Single-dad ops: Everett (11) + Berkeley (5) supported and on-schedule.
2) Courts: monitor/respond to clerk/docket/hearing notices.
3) School admin: Quest/Focal/SIS/IEP/speech comms + forms.
4) Berkeley speech: home practice + maintain SLP alignment (Danielle Ryba).
5) Everett soccer: training plan + follow-through.
6) TYFYS mission: medical evidence for VA disability claims.
7) TYFYS sales/ops reliability: Zoho + RingCentral automations must stay healthy.
8) TYFYS provider pipeline: provider replies watch + provider handoff + fulfillment tasking.
9) Backups: hourly git auto-sync + nightly OpenClaw backups must succeed.
10) LabStudio: ship real, DB-backed member flows; PR-sized; no prod deploy without explicit approval.

## 3) Today’s non-negotiables (must stay green)
- **Courts + school:** email watch jobs must keep running reliably; any replies are draft-only.
- **Backups:**
  - Hourly: `scripts/backup/git-auto-sync-all.sh`
  - Nightly: OpenClaw state bundle → Drive + local sync
- **RingCentral (RC) updates:** weekday AM posts (8:30 update, 8:32 buckets, 8:35 KPI) + 4:00pm day-cap; verify outputs non-zero/sane.

## 4) Active workstreams + next actions
### A) Drift control / continuity
- Create missing `memory/goals-master.md` with a minimal, real structure (top goals, deadlines, recurring commitments, “today non-negotiables”).
- Create `memory/2026-02-16.md` retro log reconstructed from git history + any PR draft files.

### B) TYFYS automations
- Audit enabled jobs for delivery/channel correctness (avoid accidental `whatsapp`).
- Keep RC/Zoho token + state files consistent (recent: `ringcentral-token.new.json` exists alongside `ringcentral-token.json`).

### C) LabStudio
- Continue build blocks on current PR/branch; keep “no mock data” constraint.

### D) OpenClaw dual-Mac hygiene
- Periodic check: one LaunchAgent per machine; office profile still `gateway.mode=local` + loopback bind.

## 5) Cron health (errors in last 24h)
- **ERROR:** `LabStudio deploy: shop-on-prod-baseline once Vercel quota resets` (jobId: e69a0b5d-fb54-4b65-ac83-4aad62d55e60)
  - lastError: `Unsupported channel: whatsapp`
  - Likely cause: delivery/channel drift; should be Telegram announce or `delivery.mode=none`.

## 6) Detected breakages + queued fix (apply next work block)
1) **Missing file:** `/Users/richardducat/clawd/memory/goals-master.md`
   - Fix next: create the file (seed with commitments + goals + deadlines) so cron jobs don’t crash.
2) **Missing file:** `/Users/richardducat/clawd/memory/2026-02-16.md`
   - Fix next: create retro daily note (reconstruct from git log + cron history).
3) **Cron delivery mismatch:** job e69a0b5d…
   - Fix next: patch job delivery to Telegram (or set `delivery.mode=none`) and re-run only if still needed; quick scan for any other jobs referencing `whatsapp`.
