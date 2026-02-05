import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

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

  const body = (await req.json().catch(() => ({}))) as { price_id?: unknown };
  const priceId = String(body?.price_id || '').trim();
  if (!priceId) {
    return NextResponse.json({ ok: false, error: 'Missing price_id' }, { status: 400 });
  }

  const stripe = getStripe();
  const price = await stripe.prices.retrieve(priceId);
  const mode = price.type === 'recurring' ? 'subscription' : 'payment';

  const h = await headers();
  const origin = h.get('origin') || 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${origin}/members?checkout=success`,
    cancel_url: `${origin}/members?checkout=cancel`,
    metadata: {
      labstudio_uid: uid,
      price_id: priceId,
    },
  });

  return NextResponse.json({ ok: true, url: session.url });
}
