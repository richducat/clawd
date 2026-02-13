# PR: LabStudio — DB-backed Habits check-ins

## Summary
Replaces the Habits placeholder with a real Neon-backed habits + daily check-in system.

## What changed
- DB schema (`ensureSchema`):
  - New tables: `lab_habits`, `lab_habit_checkins`
  - Indexes for user/day lookup + active habits ordering
- New API endpoint:
  - `GET /api/lab/habits`: returns active habits + whether each is checked today (ET)
  - `POST /api/lab/habits`:
    - `{action:'create', name}` creates a habit
    - `{action:'toggle', habitId}` toggles today’s check-in
- UI:
  - Habits tab now supports adding a habit + toggling Done/Not yet

## Files
- `labstudio-app/src/lib/db.ts`
- `labstudio-app/src/app/api/lab/habits/route.ts`
- `labstudio-app/src/app/members/views/HabitsView.tsx`

## How to test
1) Run app and login.
2) Go to **Habits** tab.
3) Add a habit (e.g. “Water”).
4) Tap habit to toggle Done/Not yet; refresh page to confirm it persists.

## Notes
- Day calculation uses America/New_York date boundaries.
