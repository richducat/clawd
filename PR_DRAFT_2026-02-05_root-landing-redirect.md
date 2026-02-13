# PR Draft — 2026-02-05 — Root landing + auth redirect

## Summary
Replaced the default Next.js placeholder home page (`/`) with a real Lab Studio landing screen. If a user is already authenticated (has `labstudio_session=ok` and `labstudio_uid` cookies), visiting `/` now redirects straight to `/members`.

This removes a user-visible placeholder and makes the root route behave like a real app entrypoint.

## Changes
- **labstudio-app/src/app/page.tsx**
  - Server component that:
    - reads auth cookies
    - redirects authenticated users to `/members`
    - otherwise renders a simple landing UI with links to sign in or start onboarding

## How to test (local)
1. `cd labstudio-app`
2. `npm install`
3. `npm run dev`

### Logged-out behavior
1. Open <http://localhost:3000/>
2. Confirm you see the **Lab Studio** landing with buttons:
   - **Sign in** → `/login?next=/members`
   - **New member? Start onboarding** → `/login?next=/onboarding`

### Logged-in behavior
1. In your browser devtools, set cookies for `localhost:3000`:
   - `labstudio_session=ok`
   - `labstudio_uid=test-user`
2. Refresh `/`
3. Confirm you get redirected to `/members`

## Risk assessment
- Low risk: limited to the root page (`/`) rendering + redirect.
- Uses standard Next.js server-side cookie reading (`force-dynamic`).

## Rollback
- Revert commit `12256f6` (or revert PR) to restore the previous placeholder home page.

## Notes
- This change intentionally doesn’t touch auth/session semantics; it only improves the entry experience and removes placeholder UI.
