import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';

export const runtime = 'nodejs';

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

function cents(n: number) {
  return Math.round(n * 100);
}

async function seedDefaultCafeItems() {
  const q = sql();

  // Seed with real, stable items (can be edited in DB later).
  const items = [
    { slug: 'water-bottle', name: 'Water Bottle', category: 'drinks', price_cents: cents(1.0), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/water-bottle', image_url: null },
    { slug: 'gatorade', name: 'Gatorade', category: 'drinks', price_cents: cents(3.0), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/gatorade', image_url: null },
    { slug: 'alani-energy', name: 'Alani Energy', category: 'drinks', price_cents: cents(3.75), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/alani-energy', image_url: null },
    { slug: 'celsius', name: 'Celsius', category: 'drinks', price_cents: cents(3.75), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/bloom-energy-drink', image_url: null },
    { slug: 'nurri-protein', name: 'Nurri Protein (ultra-filtered)', category: 'drinks', price_cents: cents(4.5), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/nurri-protein-ultra-filtered-milk-based', image_url: null },
    { slug: 'ready-to-go-protein-shake', name: 'Ready-to-go protein shake', category: 'drinks', price_cents: cents(5.0), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/ready-to-go-protein-shake', image_url: null },

    { slug: 'rush-small-bag', name: 'Rush Small Bag (2 servings)', category: 'snacks', price_cents: cents(6.0), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/rush-small-bag-2-servings', image_url: null },
    { slug: 'strawberry-parfait-ml', name: 'Strawberry (M/L) Parfait', category: 'snacks', price_cents: cents(9.0), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/strawberry-medium-parfait', image_url: null },

    { slug: 'meal-chicken-white-rice-broccoli', name: 'Chicken, white rice, broccoli', category: 'meals', price_cents: cents(11.5), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/medium-chicken-white-rice-broccolli', image_url: null },
    { slug: 'meal-chicken-quesadilla', name: 'Chicken quesadilla', category: 'meals', price_cents: cents(12.5), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/chicken-quesadilla', image_url: null },
    { slug: 'meal-chicken-sweet-potato-broccoli', name: 'Chicken, sweet potato, broccoli', category: 'meals', price_cents: cents(13.5), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/medium-chicken-sweet-potato-and-broccoli', image_url: null },
    { slug: 'meal-steak-white-rice-green-beans', name: 'Steak, white rice, green beans', category: 'meals', price_cents: cents(15.0), product_url: 'https://thelabstudiogym.com/studio-cafe/ols/products/medium-steak-white-rice-and-green-beans', image_url: null },
  ];

  for (const it of items) {
    await q`
      insert into lab_cafe_items (slug, name, category, price_cents, product_url, image_url, active)
      values (${it.slug}, ${it.name}, ${it.category}, ${it.price_cents}, ${it.product_url}, ${it.image_url}, true)
      on conflict (slug) do update set
        name = excluded.name,
        category = excluded.category,
        price_cents = excluded.price_cents,
        product_url = excluded.product_url,
        image_url = excluded.image_url,
        active = excluded.active;
    `;
  }
}

export async function GET() {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: false, error: 'DATABASE_URL not configured' }, { status: 400 });
  }

  // Cafe browse should not depend on uid cookie.
  const jar = await cookies();
  const uid = jar.get('labstudio_uid')?.value || null;

  await ensureSchema();
  if (uid) await getOrCreateUser(uid);

  const q = sql();

  await q`
    create table if not exists lab_cafe_items (
      slug text primary key,
      name text not null,
      category text not null,
      price_cents integer not null,
      product_url text,
      image_url text,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  const count = (await q`select count(*)::int as c from lab_cafe_items;`) as any[];
  if (Number(count?.[0]?.c ?? 0) === 0) {
    await seedDefaultCafeItems();
  }

  const items = (await q`
    select slug, name, category, price_cents, product_url, image_url
    from lab_cafe_items
    where active = true
    order by category asc, price_cents asc, name asc;
  `) as any[];

  return NextResponse.json({ ok: true, items });
}
