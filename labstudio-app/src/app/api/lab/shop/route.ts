import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

async function listStripeProducts() {
  const stripe = getStripe();

  const products = await stripe.products.list({ active: true, limit: 100 });
  const out: Array<{
    slug: string;
    name: string;
    description: string | null;
    price_cents: number | null;
    image_url: string | null;
    stripe_price_id: string | null;
  }> = [];

  for (const p of products.data) {
    // Prefer a stable, human slug from metadata if present.
    const slug = String(p.metadata?.slug || p.id);

    const prices = await stripe.prices.list({ product: p.id, active: true, limit: 10 });
    // pick the lowest unit_amount as the default
    const sorted = prices.data
      .filter((pr) => pr.unit_amount != null)
      .sort((a, b) => Number(a.unit_amount ?? 0) - Number(b.unit_amount ?? 0));

    const price = sorted[0] ?? null;

    out.push({
      slug,
      name: p.name,
      description: p.description ?? null,
      price_cents: price?.unit_amount ?? null,
      image_url: p.images?.[0] ?? null,
      stripe_price_id: price?.id ?? null,
    });
  }

  // Cheapest first
  out.sort((a, b) => Number(a.price_cents ?? 0) - Number(b.price_cents ?? 0));
  return out;
}

export async function GET() {
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

  // If Stripe is configured, use it as the source of truth.
  if (process.env.STRIPE_SECRET_KEY) {
    const products = await listStripeProducts();
    return NextResponse.json({ ok: true, products, entitlements: [] });
  }

  // Fallback: return empty list if Stripe isn't configured.
  return NextResponse.json({ ok: true, products: [], entitlements: [] });
}
