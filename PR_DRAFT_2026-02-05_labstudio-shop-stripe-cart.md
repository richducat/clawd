# PR Draft — 2026-02-05 — LabStudio Shop: Stripe-backed catalog + product pages + cart

## A) What I built tonight
- Stripe-backed Shop catalog: memberships/passes now load from Stripe Products + Prices (with images), instead of hard-coded links.
- In-app checkout initiation: server creates Stripe Checkout Sessions; client redirects to Stripe Checkout URL.
- Added product detail pages (`/members/shop/<slug>`), plus a cart that supports multi-item checkout in one session.

## B) PR-ready changes (diff summary + key files)
**Key commits (on `feat/2026-02-04-home-dashboard-real-tiles`)**
- `f964cdd` fix(labstudio): allow login cookies on localhost
- `ea9f52e` fix(labstudio): require session for members page
- `4df5a20` feat(labstudio): load shop from Stripe + in-app checkout session
- `1429178` feat(labstudio): product detail pages for shop items
- `8353991` feat(labstudio): cart + multi-item checkout
- `90721ab` feat(labstudio): auto-fill cafe images from Stripe or OG tags

**Files changed / added**
- `labstudio-app/src/lib/stripe.ts` (new) — server-side Stripe SDK wrapper
- `labstudio-app/src/app/api/lab/shop/route.ts` — load products/prices/images from Stripe
- `labstudio-app/src/app/api/lab/shop/checkout/route.ts` (new) — create checkout session for a single price
- `labstudio-app/src/app/api/lab/shop/checkout-cart/route.ts` (new) — create checkout session for multiple line items
- `labstudio-app/src/app/members/views/MarketView.tsx` — Shop list shows prices; add-to-cart; cart drawer; checkout
- `labstudio-app/src/app/members/shop/[slug]/page.tsx` (new) — product detail page
- `labstudio-app/src/app/api/lab/cafe/route.ts` — fills missing cafe images via Stripe slug match or OG-image scraping
- `labstudio-app/src/app/login/page.tsx` — localhost cookie fix
- `labstudio-app/src/app/members/page.tsx` — session required for /members

## C) How Richard tests it tomorrow
1) Start the app (more stable):
   - `cd /Users/richardducat/clawd/labstudio-app`
   - `npm run build && npm run start`
2) Login:
   - Visit `http://localhost:3000/login`
   - Access code: `LABSTUDIO2026` (from `.env.local`)
3) Shop:
   - Go to `/members` → Shop
   - Confirm products load from Stripe
   - Confirm price + image display
4) Product page:
   - Click an item → `/members/shop/<slug>`
   - Confirm description + price + checkout button
5) Cart:
   - Add multiple items from the Shop page
   - Open cart (top-right)
   - Adjust quantities; checkout

Notes:
- Stripe limitation: one Checkout Session cannot mix subscription + one-time items. Current behavior blocks mixed carts with a clear error.

## D) Next 1–3 actions
1) (Richard) Add/verify Stripe Product images + descriptions, especially for non-branded items (meal prep).
2) (Me) Add support for cafe items in the cart (requires mapping cafe items to Stripe prices or separate payment flow).
3) (Me) Add webhook handling to record entitlements after successful checkout (so memberships become “Active”).

## E) Compliance & security check
- Stripe secret key used server-side only via `STRIPE_SECRET_KEY`.
- No PHI/PII introduced.
- Checkout is hosted by Stripe (lower PCI surface area).
- `.env.local` contains secrets and is not committed.
