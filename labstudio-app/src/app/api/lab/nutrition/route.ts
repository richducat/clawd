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
