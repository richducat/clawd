## PR: Fix Home “Level” progress bar (XP is cumulative)

### Summary
The Home Level widget was calculating the progress bar as `xp / (level*1000)`, which made the bar look too full once a user passed level 1 (because XP is cumulative). This PR changes the math to show progress *within the current level*.

### Changes
- Compute `prevLevelXp = (level-1)*1000` and `nextLevelXp = level*1000`
- Progress bar now uses `(xp - prevLevelXp) / (nextLevelXp - prevLevelXp)`
- Copy tweak: “XP TO NEXT LEVEL” (was “XP TO REWARD”)

### Branch
- `feat/2026-02-07-level-progress-fix`

### Commit
- `6d92c4e` — `fix(labstudio): correct level progress bar math`

### Files changed
- `labstudio-app/src/app/members/views/HomeView.tsx`

### How to test (local)
1. `cd labstudio-app && npm run dev`
2. Login → Members → Home
3. Use any account with XP > 1000 (level 2+) and verify:
   - Progress bar represents XP earned *since the start of the current level* (e.g., XP=1500 at level 2 should show ~50%)
   - “XP TO NEXT LEVEL” matches `nextLevelXp - xp`

### Risk / rollback
- Risk: Very low (UI-only math + label).
- Rollback: revert commit `6d92c4e`.

### Compliance & security
- No PII/PHI touched. No new secrets. No external calls added.
