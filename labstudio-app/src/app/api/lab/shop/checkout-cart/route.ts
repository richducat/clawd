import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { getStripe } from '@/lib/stripe';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

type CartLine = {
  price_id: string; // either a Stripe Price ID, or "cafe:<slug>"
  quantity: number;
};

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

export async function POST(req: Request) {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: false, error: 'DATABASE_URL not configured' }, { status: 400 });
  }

  const jar = await cookies();
  const uid = jar.get('labstudio_uid')?.value;
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'Missing labstudio_uid cookie' }, { status: 401 });
  }

  await ensureSchema();
  await getOrCreateUser(uid);

  // Ensure cafe table exists even if the user hasn't loaded /api/lab/cafe yet.
  const q = sql();
  await q`
    create table if not exists lab_cafe_items (
      slug text primary key,
      name text not null,
      category text not null,
      price_cents integer not null,
      product_url text,
      image_url text,
      stripe_product_id text,
      stripe_price_id text,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;
  await q`alter table lab_cafe_items add column if not exists image_url text;`;
  await q`alter table lab_cafe_items add column if not exists stripe_product_id text;`;
  await q`alter table lab_cafe_items add column if not exists stripe_price_id text;`;

  const body = (await req.json().catch(() => ({}))) as { lines?: unknown };
  const linesRaw = Array.isArray((body as any)?.lines) ? ((body as any).lines as any[]) : [];
  const lines: CartLine[] = linesRaw
    .map((l) => ({ price_id: String(l?.price_id || '').trim(), quantity: Number(l?.quantity || 0) }))
    .filter((l) => l.price_id && Number.isFinite(l.quantity) && l.quantity > 0)
    .map((l) => ({ ...l, quantity: Math.min(99, Math.floor(l.quantity)) }));

  if (lines.length === 0) {
    return NextResponse.json({ ok: false, error: 'Cart is empty' }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ ok: false, error: 'STRIPE_SECRET_KEY not configured' }, { status: 400 });
  }

  const stripe = getStripe();

  const cafeLines = lines.filter((l) => l.price_id.startsWith('cafe:'));
  const stripeLines = lines.filter((l) => !l.price_id.startsWith('cafe:'));

  // Stripe-side price lookups for non-cafe lines.
  const prices = await Promise.all(stripeLines.map((l) => stripe.prices.retrieve(l.price_id)));
  const hasRecurring = prices.some((p) => p.type === 'recurring');
  const hasOneTimeStripe = prices.some((p) => p.type !== 'recurring');

  // Cafe items always require payment mode (one-time).
  const hasCafe = cafeLines.length > 0;

  // Stripe Checkout can’t mix subscription + one-time in one session.
  if ((hasRecurring && (hasOneTimeStripe || hasCafe)) || (hasCafe && hasRecurring)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Cart cannot mix subscriptions and one-time items yet. Please checkout memberships separately from cafe items.',
      },
      { status: 400 }
    );
  }

  const mode: 'subscription' | 'payment' = hasRecurring ? 'subscription' : 'payment';

  const cafeSlugs = cafeLines.map((l) => l.price_id.replace(/^cafe:/, '')).filter(Boolean);
  const cafeItems = cafeSlugs.length
    ? ((await q`
        select slug, name, price_cents, image_url
        from lab_cafe_items
        where slug = any(${cafeSlugs});
      `) as any[])
    : [];
  const cafeBySlug = new Map<string, any>(cafeItems.map((i) => [String(i.slug), i]));

  const line_items: any[] = [];

  // Stripe price-based line items
  for (const l of stripeLines) {
    line_items.push({ price: l.price_id, quantity: l.quantity });
  }

  // Cafe items: use Stripe "price_data" so we don't require pre-created Stripe products.
  for (const l of cafeLines) {
    const slug = l.price_id.replace(/^cafe:/, '');
    const item = cafeBySlug.get(slug);
    if (!item) continue;

    line_items.push({
      quantity: l.quantity,
      price_data: {
        currency: 'usd',
        unit_amount: Number(item.price_cents ?? 0),
        product_data: {
          name: String(item.name || slug),
          images: item.image_url ? [String(item.image_url)] : undefined,
          metadata: { cafe_slug: String(slug) },
        },
      },
    });
  }

  if (line_items.length === 0) {
    return NextResponse.json({ ok: false, error: 'Cart items not found' }, { status: 400 });
  }

  const h = await headers();
  const origin = h.get('origin') || 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode,
    line_items,
    allow_promotion_codes: true,
    success_url: `${origin}/members?checkout=success`,
    cancel_url: `${origin}/members?checkout=cancel`,
    metadata: {
      labstudio_uid: uid,
    },
  });

  return NextResponse.json({ ok: true, url: session.url });
}
