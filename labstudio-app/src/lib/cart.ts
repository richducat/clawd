'use client';

export type CartLine = {
  price_id: string;
  slug: string;
  name: string;
  unit_amount_cents: number;
  quantity: number;
  image_url: string | null;
  mode: 'subscription' | 'one_time';
};

export type CartState = {
  lines: CartLine[];
};

const KEY = 'labstudio_cart_v1';

export function readCart(): CartState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { lines: [] };
    const json = JSON.parse(raw);
    const lines = Array.isArray(json?.lines) ? json.lines : [];
    return {
      lines: lines
        .map((l: any) => ({
          price_id: String(l?.price_id || ''),
          slug: String(l?.slug || ''),
          name: String(l?.name || ''),
          unit_amount_cents: Number(l?.unit_amount_cents || 0) || 0,
          quantity: Math.max(1, Number(l?.quantity || 1) || 1),
          image_url: l?.image_url ? String(l.image_url) : null,
          mode: l?.mode === 'subscription' ? 'subscription' : 'one_time',
        }))
        .filter((l: CartLine) => l.price_id && l.name),
    };
  } catch {
    return { lines: [] };
  }
}

function persist(next: CartState): CartState {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function clearCart(): CartState {
  return persist({ lines: [] });
}

export function addToCart(line: Omit<CartLine, 'quantity'>, qty = 1): CartState {
  const cart = readCart();
  const q = Math.max(1, qty || 1);
  const idx = cart.lines.findIndex((l) => l.price_id === line.price_id);

  let nextLines = [...cart.lines];
  if (idx >= 0) {
    nextLines[idx] = { ...nextLines[idx], quantity: nextLines[idx].quantity + q };
  } else {
    nextLines.push({ ...line, quantity: q });
  }

  return persist({ lines: nextLines });
}

export function setLineQty(priceId: string, qty: number): CartState {
  const cart = readCart();
  const q = Number(qty) || 0;
  const nextLines = cart.lines
    .map((l) => (l.price_id === priceId ? { ...l, quantity: q } : l))
    .filter((l) => l.quantity > 0);
  return persist({ lines: nextLines });
}

export function cartTotals(cart: CartState) {
  const item_count = cart.lines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);
  const subtotal_cents = cart.lines.reduce((acc, l) => acc + (Number(l.unit_amount_cents) || 0) * (Number(l.quantity) || 0), 0);
  return { item_count, subtotal_cents };
}
