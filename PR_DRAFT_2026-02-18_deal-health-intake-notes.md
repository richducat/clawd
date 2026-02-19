# PR Draft — Deal health: flag missing intake notes (2026-02-18)

## A) What I shipped (1 tangible, testable improvement)
Enhanced `scripts/tyfys/deal-file-health.mjs` to automatically detect and flag **deals that appear to have had an intake completed but are missing intake notes**, so you can quickly spot the “intake happened but no notes in Zoho” throughput leak.

## B) Why this is the highest-priority item
You called out a real ops gap: intake calls are happening, but notes aren’t being captured in Zoho. That causes downstream confusion, delays, and missed follow-ups in stages 1–3.

This change makes the gap visible in the daily stage-hygiene scan without adding any manual work.

## C) How to test (tomorrow morning)
From repo root:

1) Text output (human scan):
```bash
node scripts/tyfys/deal-file-health.mjs --hours 168 --stages "Intake (Document Collection),Ready for Provider,Sent to Provider" --limit 120
```
Look for lines containing:
- `intake_notes=no ⚠️MISSING_INTAKE_NOTES`

2) JSON output (machine-readable):
```bash
node scripts/tyfys/deal-file-health.mjs --hours 168 --format json --out-json zoho_exports/deal-file-health.json
```
Then inspect:
- `deals[].risk` includes `MISSING_INTAKE_NOTES`
- `deals[].intake.completed` / `deals[].intake.notesPresent`

## D) Implementation notes (what changed)
- Added heuristics:
  - `intake.completed` if either:
    - a completed/closed task has a subject containing `intake`, OR
    - `Appointment_Status` looks like completed/done
  - `intake.notesPresent` if any related note title/content contains `intake` / `call notes` / `intake notes`
  - `missingIntakeNotes = intake.completed && !intake.notesPresent`
- Added risk flags in JSON output:
  - `MISSING_INTAKE_NOTES`, `NO_ATTACHMENTS`, `OVERDUE_TASKS`
- Added CLI options:
  - `--format json`
  - `--out-json <path>`

## E) Risk / rollback
- Risk: heuristic false positives/negatives depending on your team’s naming conventions for notes/tasks.
  - Low operational risk: it’s a read-only reporting script.
- Rollback: revert commit `d5370b1` or just stop using the `MISSING_INTAKE_NOTES` flag.

## Branch / commit
- Branch: `chore/2026-02-18-deal-health-intake-notes`
- Commit: `d5370b1`
