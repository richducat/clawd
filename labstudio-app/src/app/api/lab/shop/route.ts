import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

type StripeShopProduct = {
  slug: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  image_url: string | null;
  stripe_price_id: string | null;
};

let cache: { at: number; products: StripeShopProduct[] } | null = null;

async function listStripeProducts() {
  const now = Date.now();
  if (cache && now - cache.at < 5 * 60 * 1000) return cache.products;

  const stripe = getStripe();

  const [products, prices] = await Promise.all([
    stripe.products.list({ active: true, limit: 100 }),
    stripe.prices.list({ active: true, limit: 100 }),
  ]);

  const pricesByProduct = new Map<string, typeof prices.data>();
  for (const pr of prices.data) {
    const pid = typeof pr.product === 'string' ? pr.product : pr.product?.id;
    if (!pid) continue;
    const arr = pricesByProduct.get(pid) || [];
    arr.push(pr);
    pricesByProduct.set(pid, arr);
  }

  const out: StripeShopProduct[] = [];

  for (const p of products.data) {
    const slug = String(p.metadata?.slug || p.id);

    const pr = (pricesByProduct.get(p.id) || [])
      .filter((x) => x.unit_amount != null)
      .sort((a, b) => Number(a.unit_amount ?? 0) - Number(b.unit_amount ?? 0));

    const price = pr[0] ?? null;

    out.push({
      slug,
      name: p.name,
      description: p.description ?? null,
      price_cents: price?.unit_amount ?? null,
      image_url: p.images?.[0] ?? null,
      stripe_price_id: price?.id ?? null,
    });
  }

  out.sort((a, b) => Number(a.price_cents ?? 0) - Number(b.price_cents ?? 0));
  cache = { at: now, products: out };
  return out;
}

export async function GET() {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: false, error: 'DATABASE_URL not configured' }, { status: 400 });
  }

  // IMPORTANT: Shop browse should not require auth cookies.
  // We only use cookies when present (future: entitlements, user-specific pricing).
  const jar = await cookies();
  const uid = jar.get('labstudio_uid')?.value || null;

  if (uid) {
    await ensureSchema();
    await getOrCreateUser(uid);
  }

  // If Stripe is configured, use it as the source of truth.
  if (process.env.STRIPE_SECRET_KEY) {
    const products = await listStripeProducts();
    return NextResponse.json({ ok: true, products, entitlements: [] });
  }

  // Fallback: return empty list if Stripe isn't configured.
  return NextResponse.json({ ok: true, products: [], entitlements: [] });
}
