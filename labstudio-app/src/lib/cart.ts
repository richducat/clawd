'use client';

import { readStorage, writeStorage } from './storage';

export type CartMode = 'one_time' | 'subscription';

export type CartLine = {
  price_id: string;
  slug: string;
  name: string;
  unit_amount_cents: number;
  quantity: number;
  image_url?: string | null;
  mode: CartMode;
};

export type CartState = {
  mode: CartMode | null;
  lines: CartLine[];
};

const KEY = 'lab-cart-v2';

export function readCart(): CartState {
  return readStorage<CartState>(KEY, { mode: null, lines: [] });
}

export function writeCart(cart: CartState) {
  writeStorage(KEY, cart);
}

export function addToCart(line: Omit<CartLine, 'quantity'>, quantity = 1): CartState {
  const cart = readCart();
  const q = Math.max(1, Math.floor(quantity));

  // Enforce: cart cannot mix subscriptions + one-time items.
  if (cart.mode && cart.mode !== line.mode && cart.lines.length) {
    const out = { mode: line.mode, lines: [{ ...line, quantity: q }] };
    writeCart(out);
    return out;
  }

  const mode = cart.mode ?? line.mode;
  const idx = cart.lines.findIndex((l) => l.price_id === line.price_id);
  if (idx >= 0) {
    const next = cart.lines.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + q } : l));
    const out = { mode, lines: next };
    writeCart(out);
    return out;
  }

  const out = { mode, lines: [...cart.lines, { ...line, quantity: q }] };
  writeCart(out);
  return out;
}

export function setLineQty(price_id: string, quantity: number): CartState {
  const cart = readCart();
  const q = Math.max(0, Math.floor(quantity));
  const next = cart.lines
    .map((l) => (l.price_id === price_id ? { ...l, quantity: q } : l))
    .filter((l) => l.quantity > 0);
  const out = { mode: next.length ? cart.mode : null, lines: next };
  writeCart(out);
  return out;
}

export function clearCart(): CartState {
  const out = { mode: null, lines: [] };
  writeCart(out);
  return out;
}

export function cartTotals(cart: CartState) {
  const subtotal_cents = cart.lines.reduce((sum, l) => sum + l.unit_amount_cents * l.quantity, 0);
  const item_count = cart.lines.reduce((sum, l) => sum + l.quantity, 0);
  return { subtotal_cents, item_count };
}
