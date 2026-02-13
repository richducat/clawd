# PR: LabStudio Home — DB-backed “Things to do today” agenda

## Why
The Home dashboard previously had no end-to-end, integration-backed “daily agenda” widget in the Next.js app (the older static build had a hardcoded `DAILY_AGENDA`). This PR adds a real, DB/integration-driven agenda that reflects actual user activity (check-ins, nutrition logging, habits) plus optional planned agenda items.

## What changed
- **DB schema**: added `lab_agenda_items` (optional planned items) to `ensureSchema()`.
- **API**:
  - `GET /api/lab/agenda` returns today’s agenda (America/New_York), derived from:
    - daily stats logged today
    - progress photos uploaded today
    - nutrition entries logged today
    - active habits + today check-in status
    - optional planned `lab_agenda_items` for today
  - `GET /api/lab/home` now includes `home.agenda` so the HomeView can render the widget without extra round-trips.
- **UI**: Home dashboard now renders **“Things to do today”** with real completion states and jump-ins:
  - Daily stats → opens Quick Log
  - Progress photo → opens Progress > Photos
  - Nutrition → opens Nutrition
  - Habits → opens Habits

## Notes / constraints
- Timezone for “today” is consistently **America/New_York** (same as other Home widgets).
- Planned agenda items support is schema + read-path only for now (no UI to create/edit yet).

## Test plan
1. Set `DATABASE_URL` and run the app.
2. Visit `/members` (ensure `labstudio_uid` cookie exists).
3. On Home:
   - Confirm **Things to do today** renders and shows completion states.
   - Click **Jump in** on **Daily stats check-in** → Quick Log opens; Save; item flips to done after refresh.
   - Upload a progress photo via Daily Check-in → Progress photo item flips to done after refresh.
   - Log any nutrition entry → Nutrition item flips to done.
   - Create an active habit and check it in for today → habit shows as done.
4. `npm run build` in `labstudio-app`.

## Rollback
- Revert commit `5e54566`.
- (Optional) drop table if needed:
  ```sql
  drop table if exists lab_agenda_items;
  ```

## Screenshots
N/A (UI-only change; can be added after merge if needed)
