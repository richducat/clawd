'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '../components/Card';
import { addToCart, cartTotals, clearCart, readCart, setLineQty, type CartState } from '@/lib/cart';

type ShopProduct = {
  slug: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  checkout_url?: string | null;
  image_url?: string | null;
  stripe_price_id?: string | null;
};

type CafeItem = {
  slug: string;
  name: string;
  category: string;
  price_cents: number;
  product_url: string | null;
  image_url?: string | null;
  stripe_price_id?: string | null;
};

export default function MarketView() {
  const [data, setData] = useState<{ products: ShopProduct[]; entitlements: string[] } | null>(null);
  const [cafe, setCafe] = useState<CafeItem[] | null>(null);

  // Cart (local-only for now)
  const [cart, setCart] = useState<CartState>(() => readCart());
  const [cartOpen, setCartOpen] = useState(false);

  const [checkoutProduct, setCheckoutProduct] = useState<ShopProduct | null>(null);

  useEffect(() => {
    fetch('/api/lab/shop')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setData({ products: j.products ?? [], entitlements: j.entitlements ?? [] });
      })
      .catch(() => {
        // ignore
      });

    fetch('/api/lab/cafe')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setCafe(j.items ?? []);
        else setCafe([]);
      })
      .catch(() => setCafe([]));
  }, []);

  const checkoutPrice = useMemo(() => {
    if (!checkoutProduct?.price_cents) return null;
    return `$${(checkoutProduct.price_cents / 100).toFixed(2)}`;
  }, [checkoutProduct?.price_cents]);

  const totals = useMemo(() => cartTotals(cart), [cart]);

  const checkoutCart = async () => {
    try {
      const res = await fetch('/api/lab/shop/checkout-cart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines: cart.lines.map((l) => ({ price_id: l.price_id, quantity: l.quantity })) }),
      });
      const j = await res.json();
      if (j?.ok && j.url) {
        window.location.href = String(j.url);
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Cart */}
      {cartOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-3"
          onClick={() => setCartOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-4"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Cart</div>
                <div className="text-lg font-black italic mt-1">{totals.item_count} item(s)</div>
              </div>
              <button
                type="button"
                className="text-xs font-black text-zinc-200 bg-white/10 hover:bg-white/15 px-3 py-2 rounded-xl"
                onClick={() => setCartOpen(false)}
              >
                Close
              </button>
            </div>

            {cart.lines.length ? (
              <div className="mt-3 space-y-2">
                {cart.lines.map((l) => (
                  <div key={l.price_id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-bold truncate">{l.name}</div>
                      <div className="text-xs text-zinc-500">${(l.unit_amount_cents / 100).toFixed(2)} each</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 rounded-lg bg-zinc-800"
                        onClick={() => setCart(setLineQty(l.price_id, l.quantity - 1))}
                      >
                        -
                      </button>
                      <div className="w-8 text-center font-mono">{l.quantity}</div>
                      <button
                        type="button"
                        className="px-2 py-1 rounded-lg bg-zinc-800"
                        onClick={() => setCart(setLineQty(l.price_id, l.quantity + 1))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 text-xs text-zinc-500">Cart is empty.</div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm font-black">Subtotal</div>
              <div className="text-sm font-black">${(totals.subtotal_cents / 100).toFixed(2)}</div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="text-xs font-black text-zinc-200 bg-white/10 hover:bg-white/15 px-3 py-3 rounded-xl"
                onClick={() => setCart(clearCart())}
              >
                Clear
              </button>
              <button
                type="button"
                disabled={!cart.lines.length}
                className="text-xs font-black text-zinc-950 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 px-3 py-3 rounded-xl"
                onClick={checkoutCart}
              >
                Checkout
              </button>
            </div>

            <div className="mt-2 text-[11px] text-zinc-500">Note: cart can’t mix subscriptions + one-time items yet.</div>
          </div>
        </div>
      ) : null}

      {checkoutProduct ? (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-3"
          onClick={() => setCheckoutProduct(null)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-4"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Checkout</div>
                <div className="text-lg font-black italic mt-1">{checkoutProduct.name}</div>
                {checkoutProduct.description ? (
                  <div className="text-xs text-zinc-400 mt-1">{checkoutProduct.description}</div>
                ) : null}
              </div>
              <button
                type="button"
                className="text-xs font-black text-zinc-200 bg-white/10 hover:bg-white/15 px-3 py-2 rounded-xl"
                onClick={() => setCheckoutProduct(null)}
              >
                Close
              </button>
            </div>

            {checkoutProduct.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={checkoutProduct.image_url}
                alt={checkoutProduct.name}
                className="w-full h-44 mt-3 rounded-2xl object-cover border border-white/10 bg-zinc-900"
              />
            ) : null}

            <div className="mt-3 flex items-center justify-between">
              <div className="text-sm text-zinc-300">{checkoutPrice ?? ''}</div>
              <div className="text-xs text-zinc-500">Secure checkout powered by Stripe</div>
            </div>

            {checkoutProduct.stripe_price_id ? (
              <button
                type="button"
                className="mt-4 w-full text-center text-sm font-black text-zinc-950 bg-yellow-400 hover:bg-yellow-300 px-4 py-3 rounded-2xl"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/lab/shop/checkout', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ price_id: checkoutProduct.stripe_price_id }),
                    });
                    const j = await res.json();
                    if (j?.ok && j.url) window.location.href = String(j.url);
                  } catch {
                    // ignore
                  }
                }}
              >
                Continue to secure checkout
              </button>
            ) : checkoutProduct.checkout_url ? (
              <a
                href={checkoutProduct.checkout_url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 block text-center text-sm font-black text-zinc-950 bg-yellow-400 hover:bg-yellow-300 px-4 py-3 rounded-2xl"
              >
                Continue to secure checkout
              </a>
            ) : (
              <div className="mt-4 text-xs text-zinc-500">Not available right now.</div>
            )}
          </div>
        </div>
      ) : null}

      <div className="px-1 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black italic uppercase">Shop</h1>
          <div className="text-xs text-zinc-500 mt-1">Memberships, passes, and Studio Cafe.</div>
        </div>

        <button
          type="button"
          className="shrink-0 text-xs font-black text-zinc-950 bg-yellow-400 hover:bg-yellow-300 px-3 py-2 rounded-xl"
          onClick={() => setCartOpen(true)}
        >
          Cart ({totals.item_count})
        </button>
      </div>

      {!data ? (
        <Card className="p-4">
          <div className="text-sm text-zinc-300">Loading memberships…</div>
        </Card>
      ) : data.products.length === 0 ? (
        <Card className="p-4">
          <div className="text-sm text-zinc-300">No memberships/passes available yet.</div>
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="px-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Memberships / Passes</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.products.map((p) => {
              const owned = data.entitlements.includes(p.slug);
              const clickable = Boolean(p.stripe_price_id || p.checkout_url);

              return (
                <Card
                  key={p.slug}
                  className={`p-4 space-y-2 ${clickable ? 'cursor-pointer hover:border-yellow-500/30' : ''}`}
                  onClick={() => {
                    if (!clickable) return;
                    setCheckoutProduct(p);
                  }}
                >
                  <div className="flex items-start gap-3">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image_url}
                        alt={p.name}
                        className="w-16 h-16 rounded-xl object-cover border border-white/10 bg-zinc-900"
                        loading="lazy"
                      />
                    ) : null}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold">{p.name}</div>
                          {p.description ? <div className="text-xs text-zinc-500 mt-1">{p.description}</div> : null}
                        </div>
                        {owned ? (
                          <div className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-full">Active</div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {clickable ? (
                    <div className="flex items-center justify-end gap-2">
                      {p.stripe_price_id ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const next = addToCart(
                              {
                                price_id: String(p.stripe_price_id),
                                slug: p.slug,
                                name: p.name,
                                unit_amount_cents: p.price_cents ?? 0,
                                image_url: p.image_url ?? null,
                                mode: 'subscription',
                              },
                              1,
                            );
                            setCart(next);
                          }}
                          className="inline-block text-xs font-black text-zinc-950 bg-yellow-400 hover:bg-yellow-300 px-3 py-2 rounded-xl"
                        >
                          Add
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCheckoutProduct(p);
                        }}
                        className="inline-block text-xs font-black text-zinc-200 bg-white/10 hover:bg-white/15 px-3 py-2 rounded-xl"
                      >
                        Checkout
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">Not available right now.</div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {cafe === null ? (
        <Card className="p-4">
          <div className="text-sm text-zinc-300">Loading Studio Cafe…</div>
        </Card>
      ) : cafe.length === 0 ? (
        <Card className="p-4">
          <div className="text-sm text-zinc-300">No cafe items available yet.</div>
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="px-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Studio Cafe</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {cafe.map((it) => (
              <Card key={it.slug} className="p-4 space-y-2">
                <div className="flex items-start gap-3">
                  {it.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.image_url}
                      alt={it.name}
                      className="w-16 h-16 rounded-xl object-cover border border-white/10 bg-zinc-900"
                      loading="lazy"
                    />
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold">{it.name}</div>
                        <div className="text-xs text-zinc-500 mt-1">{it.category.toUpperCase()}</div>
                      </div>
                      <div className="text-sm font-black">${(it.price_cents / 100).toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  {it.stripe_price_id ? (
                    <button
                      type="button"
                      onClick={() => {
                        const next = addToCart(
                          {
                            price_id: String(it.stripe_price_id),
                            slug: it.slug,
                            name: it.name,
                            unit_amount_cents: it.price_cents,
                            image_url: it.image_url ?? null,
                            mode: 'one_time',
                          },
                          1,
                        );
                        setCart(next);
                      }}
                      className="inline-block text-xs font-black text-zinc-950 bg-yellow-400 hover:bg-yellow-300 px-3 py-2 rounded-xl"
                    >
                      Add
                    </button>
                  ) : (
                    <div className="text-xs text-zinc-500">(Not in Stripe yet)</div>
                  )}

                  {it.product_url ? (
                    <a
                      href={it.product_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs font-black text-zinc-200 bg-white/10 hover:bg-white/15 px-3 py-2 rounded-xl"
                    >
                      View
                    </a>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
