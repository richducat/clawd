import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

type Body = {
  kind?: string;
  durationMin?: number | string;
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
  const kind = (body.kind || 'workout').slice(0, 50);
  const durationMin = body.durationMin == null || body.durationMin === '' ? null : Number(body.durationMin);
  const note = body.note?.slice(0, 2000) ?? null;

  await ensureSchema();
  await getOrCreateUser(uid);

  const q = sql();
  const rows = (await q`
    insert into lab_workout_log (user_id, kind, duration_min, note)
    values (${uid}, ${kind}, ${Number.isFinite(durationMin as any) ? durationMin : null}, ${note})
    returning id, created_at;
  `) as any[];

  return NextResponse.json({ ok: true, saved: rows?.[0] ?? null });
}
