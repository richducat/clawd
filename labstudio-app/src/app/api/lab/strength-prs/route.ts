import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

type Body = {
  lift?: string;
  value?: number | string;
  unit?: string;
  reps?: number | string;
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
  const rows = (await q`
    select id, created_at, lift, value, unit, reps
    from lab_strength_prs
    where user_id = ${uid}
    order by created_at desc
    limit 1;
  `) as any[];

  return NextResponse.json({ ok: true, latest: rows?.[0] ?? null });
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
  const lift = (body.lift || '').trim().slice(0, 80);
  const valueNum = body.value == null || body.value === '' ? NaN : Number(body.value);
  const unit = (body.unit || 'lb').trim().slice(0, 10);
  const repsNum = body.reps == null || body.reps === '' ? null : Number(body.reps);

  if (!lift) return NextResponse.json({ ok: false, error: 'Missing lift' }, { status: 400 });
  if (!Number.isFinite(valueNum)) return NextResponse.json({ ok: false, error: 'Invalid value' }, { status: 400 });

  await ensureSchema();
  await getOrCreateUser(uid);

  const q = sql();
  const rows = (await q`
    insert into lab_strength_prs (user_id, lift, value, unit, reps)
    values (${uid}, ${lift}, ${valueNum}, ${unit}, ${Number.isFinite(repsNum as any) ? repsNum : null})
    returning id, created_at;
  `) as any[];

  return NextResponse.json({ ok: true, saved: rows?.[0] ?? null });
}
