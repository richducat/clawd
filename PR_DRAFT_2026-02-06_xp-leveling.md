# PR Draft — 2026-02-06 — XP + leveling updates on Home dashboard

## A) What I built tonight
- Added **real XP awards** when a member logs:
  - Daily check-in (stats) (once/day)
  - Nutrition entry
  - Workout
  - Progress photo
  - Strength PR
- Updated **Home dashboard Level/XP progress** to reflect the DB-backed XP/level (via `/api/lab/home`) so it updates right after you save a check-in.
- Fixed the **level threshold math** so “XP to reward” is consistent with `level = floor(xp/1000)+1`.

## B) PR-ready changes
**Branch:** `feat/2026-02-06-xp-leveling`

**Commit:** `57576c5` — `feat(labstudio): award XP for logs + show live level on Home`

**Files changed**
- `labstudio-app/src/lib/db.ts`
  - Added `addXp(userId, delta)` helper (atomic XP + level update)
- `labstudio-app/src/app/api/lab/daily-stats/route.ts`
  - Awards +25 XP for the first daily check-in of the day (ET)
- `labstudio-app/src/app/api/lab/nutrition/route.ts`
  - Awards +5 XP per nutrition log entry
- `labstudio-app/src/app/api/lab/workouts/route.ts`
  - Awards +50 XP per workout log
- `labstudio-app/src/app/api/lab/progress-photos/route.ts`
  - Awards +30 XP per progress photo
- `labstudio-app/src/app/api/lab/strength-prs/route.ts`
  - Awards +40 XP per PR
- `labstudio-app/src/app/api/lab/home/route.ts`
  - Includes `{ user: { xp, level, food_credits } }` in response
- `labstudio-app/src/app/members/views/HomeView.tsx`
  - Uses `home.user` (when present) for Level/XP/Credits
  - Fixes next-level threshold calculation

## C) How Richard tests it tomorrow
1) In `labstudio-app`, run:
   - `npm run dev`
2) Log into `/members` (with your existing cookie flow).
3) On Home:
   - Open **Daily Check-in** → save weight/bodyfat (and optionally a photo).
   - Confirm the **Level card** updates after the save (because Home refetches `/api/lab/home`).
4) Log a workout and a nutrition item:
   - Confirm XP/Level changes show up after a refresh (or after any action that triggers a Home refetch).
5) Optional: hit the API directly:
   - `GET /api/lab/home` should include `home.user.xp` and `home.user.level`.

## D) Next 1–3 actions
- **(Me)** If you like the XP values, I’ll wire the non-Home views (Workout/Nutrition/Progress) to refresh `home.user` in-place after saving so you don’t need to bounce back to Home to see the updated level.
- **(Richard)** Tell me if you want different XP weights (e.g., daily check-in higher, nutrition lower, caps).

## E) Compliance & security check
- No PHI/PII added.
- DB updates are minimal and scoped to the authenticated user id from `labstudio_uid` cookie.
- XP updates are atomic in a single SQL `update ... returning`.
