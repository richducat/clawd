# PR Draft — 2026-02-08 — LabStudio Home: real loading/empty states (no “looks-real” zeroes)

## Summary
Home previously rendered several numeric widgets with `0` before `/api/lab/home` returned (e.g., Nutrition Today, Session Log, Progress Photos). That looks like real data when it’s actually “not loaded yet.”

This PR:
- Adds an explicit `homeLoaded` gate for Home’s numeric widgets.
- Shows `—` until data arrives (then shows real numbers).
- Tightens ProgressTile typing so we don’t use `any` for icons (reduces eslint noise).

## Files changed
- `labstudio-app/src/app/members/views/HomeView.tsx`
- `labstudio-app/src/app/members/data/home.ts`

## How to test
1. `cd /Users/richardducat/clawd/labstudio-app`
2. `npm run dev`
3. Open the Members Home.
4. Hard refresh with DevTools open, optionally throttle network (Slow 3G).
5. Verify that before the Home API returns:
   - Nutrition Today shows `—` (not `0`).
   - Session Log shows `—` (not `0`).
   - Progress Photos tile shows `—` (not `0`).
6. After the API returns, verify real values populate.

## Notes
- `npm run build` passes.
- `npm run lint` fails in this repo due to pre-existing `no-explicit-any` issues in multiple API routes; this PR reduces (doesn’t increase) lint issues by removing one `any` usage in the Home tiles.

## Risk
Low. UI-only conditional rendering; no API/schema changes.

## Rollback
- `git revert 17fde18`
