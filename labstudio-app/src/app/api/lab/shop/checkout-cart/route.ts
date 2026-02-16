import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

type Line = { price_id: string; quantity: number };

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

  const body = (await req.json().catch(() => ({}))) as { lines?: unknown };
  const linesIn = Array.isArray(body?.lines) ? (body.lines as any[]) : [];
  const lines: Line[] = linesIn
    .map((l) => ({
      price_id: String(l?.price_id || '').trim(),
      quantity: Math.max(1, Number(l?.quantity || 1) || 1),
    }))
    .filter((l) => l.price_id);

  if (!lines.length) {
    return NextResponse.json({ ok: false, error: 'Cart is empty' }, { status: 400 });
  }

  const stripe = getStripe();

  // Determine mode: all recurring -> subscription; all one_time -> payment; mixed not supported.
  const prices = await Promise.all(lines.map((l) => stripe.prices.retrieve(l.price_id)));
  const hasRecurring = prices.some((p) => p.type === 'recurring');
  const hasOneTime = prices.some((p) => p.type === 'one_time');
  if (hasRecurring && hasOneTime) {
    return NextResponse.json(
      { ok: false, error: "Cart can't mix subscriptions and one-time items yet." },
      { status: 400 },
    );
  }

  const mode = hasRecurring ? 'subscription' : 'payment';

  const h = await headers();
  const origin = h.get('origin') || 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: lines.map((l) => ({ price: l.price_id, quantity: l.quantity })),
    allow_promotion_codes: true,
    success_url: `${origin}/members?checkout=success`,
    cancel_url: `${origin}/members?checkout=cancel`,
    metadata: {
      labstudio_uid: uid,
      kind: 'cart',
    },
  });

  return NextResponse.json({ ok: true, url: session.url });
}
