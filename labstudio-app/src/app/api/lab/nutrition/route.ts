import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

type Body = {
  name?: string;
  p?: number;
  c?: number;
  f?: number;
  time?: string;
};

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
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

  const q = sql();

  // Today's totals + entries (ET)
  const totals = (await q`
    select
      coalesce(sum(protein_g), 0) as protein_g,
      coalesce(sum(carbs_g), 0) as carbs_g,
      coalesce(sum(fat_g), 0) as fat_g
    from lab_nutrition_log
    where user_id = ${uid}
      and (created_at at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date;
  `) as any[];

  const entries = (await q`
    select id, created_at, name, protein_g, carbs_g, fat_g, time_label
    from lab_nutrition_log
    where user_id = ${uid}
      and (created_at at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date
    order by created_at desc
    limit 30;
  `) as any[];

  const last7 = (await q`
    select
      (created_at at time zone 'America/New_York')::date as day,
      coalesce(sum(protein_g), 0)::int as protein_g,
      coalesce(sum(carbs_g), 0)::int as carbs_g,
      coalesce(sum(fat_g), 0)::int as fat_g
    from lab_nutrition_log
    where user_id = ${uid}
      and (created_at at time zone 'America/New_York')::date >= ((now() at time zone 'America/New_York')::date - 6)
    group by day
    order by day asc;
  `) as any[];

  const t = totals?.[0] ?? { protein_g: 0, carbs_g: 0, fat_g: 0 };
  const todayCalories = Number(t.protein_g) * 4 + Number(t.carbs_g) * 4 + Number(t.fat_g) * 9;

  const last7WithCalories = (last7 || []).map((d: any) => {
    const cals = Number(d.protein_g) * 4 + Number(d.carbs_g) * 4 + Number(d.fat_g) * 9;
    return { day: String(d.day), protein_g: Number(d.protein_g), carbs_g: Number(d.carbs_g), fat_g: Number(d.fat_g), calories: cals };
  });

  const sum7 = last7WithCalories.reduce(
    (acc, d) => ({
      calories: acc.calories + d.calories,
      protein_g: acc.protein_g + d.protein_g,
      carbs_g: acc.carbs_g + d.carbs_g,
      fat_g: acc.fat_g + d.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );

  // Always divide by 7 to keep the "avg" consistent even if some days have no logs.
  const avg7 = {
    calories: Math.round(sum7.calories / 7),
    protein_g: Math.round(sum7.protein_g / 7),
    carbs_g: Math.round(sum7.carbs_g / 7),
    fat_g: Math.round(sum7.fat_g / 7),
  };

  return NextResponse.json({
    ok: true,
    today: {
      protein_g: Number(t.protein_g),
      carbs_g: Number(t.carbs_g),
      fat_g: Number(t.fat_g),
      calories: todayCalories,
      entries,
    },
    last7: last7WithCalories,
    avg7,
  });
}

export async function POST(req: Request) {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: false, error: 'DATABASE_URL not configured' }, { status: 400 });
  }

  const jar = await cookies();
  const uid = jar.get('labstudio_uid')?.value;
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'Missing labstudio_uid cookie' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ ok: false, error: 'Missing name' }, { status: 400 });

  const p = Math.max(0, Math.floor(Number(body.p ?? 0)));
  const c = Math.max(0, Math.floor(Number(body.c ?? 0)));
  const f = Math.max(0, Math.floor(Number(body.f ?? 0)));
  const time = (body.time ?? '').trim() || null;

  await ensureSchema();
  await getOrCreateUser(uid);

  const q = sql();
  const rows = (await q`
    insert into lab_nutrition_log (user_id, name, protein_g, carbs_g, fat_g, time_label)
    values (${uid}, ${name}, ${p}, ${c}, ${f}, ${time})
    returning id, created_at;
  `) as any[];

  return NextResponse.json({ ok: true, saved: rows?.[0] ?? null });
}
