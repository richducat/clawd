import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type UnifiedFood = {
  id: string;
  source: 'usda' | 'off';
  label: string;
  brand?: string;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  basis?: 'per_serving' | 'per_100g' | 'unknown';
};

function n(v: unknown): number | null {
  const x = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(x) ? x : null;
}

function pickNumberByNutrientId(foodNutrients: any[] | undefined, nutrientId: number) {
  if (!Array.isArray(foodNutrients)) return null;
  const hit = foodNutrients.find((fn) => fn?.nutrientId === nutrientId);
  return n(hit?.value);
}

async function usdaSearch(q: string, limit: number): Promise<UnifiedFood[]> {
  const key = process.env.USDA_FDC_API_KEY;
  if (!key) return [];

  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('api_key', key);
  url.searchParams.set('query', q);
  url.searchParams.set('pageSize', String(limit));

  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => ({}))) as any;

  const foods = Array.isArray(json?.foods) ? json.foods : [];
  return foods.slice(0, limit).map((f: any) => {
    const foodNutrients = Array.isArray(f?.foodNutrients) ? f.foodNutrients : [];

    // USDA nutrient IDs (common):
    // 1008 = Energy (kcal)
    // 1003 = Protein
    // 1005 = Carbohydrate
    // 1004 = Total lipid (fat)
    const calories = pickNumberByNutrientId(foodNutrients, 1008);
    const protein_g = pickNumberByNutrientId(foodNutrients, 1003);
    const carbs_g = pickNumberByNutrientId(foodNutrients, 1005);
    const fat_g = pickNumberByNutrientId(foodNutrients, 1004);

    const description = String(f?.description || '').trim();
    const brand = String(f?.brandName || '').trim() || undefined;

    // USDA search results can be "per 100g" or "per serving" depending on item.
    // We treat as unknown for now; UI will not auto-scale unless basis==per_100g.
    const label = [brand, description].filter(Boolean).join(' — ') || 'Food';

    return {
      id: `usda:${String(f?.fdcId)}`,
      source: 'usda',
      label,
      brand,
      calories,
      protein_g,
      carbs_g,
      fat_g,
      basis: 'unknown',
    } satisfies UnifiedFood;
  });
}

async function offSearch(q: string, limit: number): Promise<UnifiedFood[]> {
  const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  url.searchParams.set('search_terms', q);
  url.searchParams.set('search_simple', '1');
  url.searchParams.set('action', 'process');
  url.searchParams.set('json', '1');
  url.searchParams.set('page_size', String(limit));

  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => ({}))) as any;

  const products = Array.isArray(json?.products) ? json.products : [];
  return products.slice(0, limit).map((p: any) => {
    const name = String(p?.product_name || p?.generic_name || '').trim();
    const brand = String(p?.brands || '').split(',')[0]?.trim() || undefined;

    const nutr = p?.nutriments || {};
    // OFF is typically per 100g
    const calories = n(nutr['energy-kcal_100g'] ?? nutr['energy-kcal']);
    const protein_g = n(nutr['proteins_100g']);
    const carbs_g = n(nutr['carbohydrates_100g']);
    const fat_g = n(nutr['fat_100g']);

    const label = [brand, name || 'Food'].filter(Boolean).join(' — ');

    return {
      id: `off:${String(p?.code || p?._id || p?.id || name)}`,
      source: 'off',
      label,
      brand,
      calories,
      protein_g,
      carbs_g,
      fat_g,
      basis: 'per_100g',
    } satisfies UnifiedFood;
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || '8'), 1), 12);

  if (!q || q.length < 2) {
    return NextResponse.json({ ok: true, q, foods: [] as UnifiedFood[] });
  }

  const [usda, off] = await Promise.all([usdaSearch(q, limit), offSearch(q, limit)]);

  // naive merge: prioritize USDA, then OFF, cap total
  const foods = [...usda, ...off].slice(0, limit);

  return NextResponse.json({ ok: true, q, foods });
}
