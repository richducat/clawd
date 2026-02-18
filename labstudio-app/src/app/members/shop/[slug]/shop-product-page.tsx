'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '../../components/Card';
import { addToCart, cartTotals, readCart, type CartState } from '@/lib/cart';

type ShopProduct = {
  slug: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  image_url?: string | null;
  stripe_price_id?: string | null;
};

export default function ShopProductPage({ slug }: { slug: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<ShopProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartState>(() => readCart());

  const totals = useMemo(() => cartTotals(cart), [cart]);

  useEffect(() => {
    fetch('/api/lab/shop')
      .then((r) => r.json())
      .then((j) => {
        const list = (j?.products ?? []) as ShopProduct[];
        const found = list.find((p) => String(p.slug) === String(slug)) ?? null;
        setProduct(found);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load product');
        setLoading(false);
      });
  }, [slug]);

  const priceLabel = product?.price_cents != null ? `$${(product.price_cents / 100).toFixed(2)}` : '';

  const add = () => {
    if (!product?.stripe_price_id) return;
    const next = addToCart(
      {
        price_id: String(product.stripe_price_id),
        slug: product.slug,
        name: product.name,
        unit_amount_cents: product.price_cents ?? 0,
        image_url: product.image_url ?? null,
        mode: 'subscription',
      },
      1
    );
    setCart(next);
  };

  const buyNow = async () => {
    if (!product?.stripe_price_id) return;
    try {
      const res = await fetch('/api/lab/shop/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ price_id: product.stripe_price_id }),
      });
      const j = await res.json();
      if (j?.ok && j.url) window.location.href = String(j.url);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans selection:bg-violet-500/30">
      <div className="max-w-md lg:max-w-3xl mx-auto p-4 pb-24">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="text-xs font-black text-zinc-200 bg-white/10 hover:bg-white/15 px-3 py-2 rounded-xl"
            onClick={() => router.back()}
          >
            Back
          </button>
          <button
            type="button"
            className="text-xs font-black text-zinc-950 bg-yellow-400 hover:bg-yellow-300 px-3 py-2 rounded-xl"
            onClick={() => router.push('/members')}
            title="Return to the app"
          >
            App
          </button>
        </div>

        {loading ? (
          <Card className="p-4 mt-4">
            <div className="text-sm text-zinc-300">Loading…</div>
          </Card>
        ) : error ? (
          <Card className="p-4 mt-4">
            <div className="text-sm text-zinc-300">{error}</div>
          </Card>
        ) : !product ? (
          <Card className="p-4 mt-4">
            <div className="text-sm text-zinc-300">Product not found.</div>
            <div className="text-xs text-zinc-500 mt-2">Slug: {slug}</div>
          </Card>
        ) : (
          <div className="mt-4 space-y-3">
            <Card className="p-4">
              <div className="flex items-start gap-3">
                {product.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-20 h-20 rounded-2xl object-cover border border-white/10 bg-zinc-900"
                    loading="lazy"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-black italic">{product.name}</div>
                  {product.description ? <div className="text-sm text-zinc-400 mt-1">{product.description}</div> : null}
                  <div className="text-lg font-black text-zinc-100 mt-2">{priceLabel}</div>
                </div>
              </div>

              {!product.stripe_price_id ? (
                <div className="text-xs text-zinc-500 mt-3">This product isn’t purchasable yet (missing Stripe price).</div>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="text-xs font-black text-zinc-950 bg-yellow-400 hover:bg-yellow-300 px-3 py-3 rounded-xl"
                    onClick={buyNow}
                  >
                    Buy now
                  </button>
                  <button
                    type="button"
                    className="text-xs font-black text-zinc-200 bg-white/10 hover:bg-white/15 px-3 py-3 rounded-xl"
                    onClick={add}
                  >
                    Add to cart
                  </button>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Cart</div>
              <div className="mt-2 flex items-center justify-between">
                <div className="text-sm font-black">{totals.item_count} item(s)</div>
                <div className="text-sm font-black">${(totals.subtotal_cents / 100).toFixed(2)}</div>
              </div>
              <div className="text-xs text-zinc-500 mt-2">Checkout from the Shop tab inside the app.</div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
