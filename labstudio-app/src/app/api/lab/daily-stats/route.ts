import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

type Body = {
  weight?: string | number;
  bodyFat?: string | number;
  note?: string;
};

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
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

  await ensureSchema();
  await getOrCreateUser(uid);

  const weight = body.weight === '' || body.weight == null ? null : Number(body.weight);
  const bodyFat = body.bodyFat === '' || body.bodyFat == null ? null : Number(body.bodyFat);
  const note = body.note?.slice(0, 2000) ?? null;

  const q = sql();
  const rows = (await q`
    insert into lab_daily_stats (user_id, weight_lbs, body_fat_pct, note)
    values (${uid}, ${Number.isFinite(weight as any) ? weight : null}, ${Number.isFinite(bodyFat as any) ? bodyFat : null}, ${note})
    returning id, created_at;
  `) as any[];

  return NextResponse.json({ ok: true, saved: rows?.[0] ?? null });
}
