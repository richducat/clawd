'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type ShopProduct = {
  slug: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  image_url?: string | null;
  stripe_price_id?: string | null;
  checkout_url?: string | null;
};

export default function ShopProductPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const [p, setP] = useState<ShopProduct | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch('/api/lab/shop')
      .then((r) => r.json())
      .then((j) => {
        if (!mounted) return;
        if (j?.ok && Array.isArray(j.products)) {
          const found = (j.products as ShopProduct[]).find((x) => x.slug === slug) || null;
          setP(found);
        } else {
          setP(null);
        }
      })
      .catch(() => {
        if (!mounted) return;
        setP(null);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [slug]);

  const price = useMemo(() => {
    if (!p || p.price_cents == null) return '';
    return `$${(p.price_cents / 100).toFixed(2)}`;
  }, [p]);

  const checkoutable = Boolean(p?.stripe_price_id || p?.checkout_url);

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: '#a1a1aa', textTransform: 'uppercase' }}>Shop</div>
          <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.5, marginTop: 6 }}>{p?.name || 'Product'}</h1>
        </div>
        <Link href="/members" style={{ fontSize: 13, fontWeight: 800 }}>
          Back
        </Link>
      </div>

      {loading ? <p style={{ color: '#a1a1aa', marginTop: 12 }}>Loading…</p> : null}

      {!loading && !p ? (
        <p style={{ color: '#a1a1aa', marginTop: 12 }}>Product not found.</p>
      ) : null}

      {p?.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.image_url}
          alt={p.name}
          style={{ width: '100%', height: 320, objectFit: 'cover', borderRadius: 18, marginTop: 16, border: '1px solid rgba(255,255,255,0.08)' }}
        />
      ) : null}

      {p ? (
        <>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{price}</div>
            <div style={{ fontSize: 12, color: '#a1a1aa' }}>Secure checkout powered by Stripe</div>
          </div>

          {p.description ? <p style={{ marginTop: 12, color: '#d4d4d8' }}>{p.description}</p> : null}

          {checkoutable ? (
            <button
              type="button"
              style={{
                marginTop: 16,
                width: '100%',
                padding: 14,
                borderRadius: 14,
                fontWeight: 900,
                background: '#facc15',
                color: '#09090b',
                cursor: 'pointer',
              }}
              onClick={async () => {
                try {
                  if (p.stripe_price_id) {
                    const res = await fetch('/api/lab/shop/checkout', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ price_id: p.stripe_price_id }),
                    });
                    const j = await res.json();
                    if (j?.ok && j.url) window.location.href = String(j.url);
                    return;
                  }
                  if (p.checkout_url) {
                    window.location.href = p.checkout_url;
                  }
                } catch {
                  // ignore
                }
              }}
            >
              Continue to secure checkout
            </button>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
