import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { ensureBookingSchema, parseTimeLabelToMinutes } from './_schema';

export const runtime = 'nodejs';

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
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
  await ensureBookingSchema();

  const q = sql();
  const today = fmtDay(new Date());

  const upcoming = (await q`
    select id, created_at, day, time_label, duration_min, status, note
    from lab_bookings
    where user_id = ${uid}
      and day >= ${today}::date
      and status <> 'cancelled'
    order by day asc, time_label asc
    limit 20;
  `) as any[];

  return NextResponse.json({ ok: true, bookings: upcoming });
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

  await ensureSchema();
  await getOrCreateUser(uid);
  await ensureBookingSchema();

  const body = (await req.json().catch(() => ({}))) as { day?: unknown; time_label?: unknown; note?: unknown };
  const day = String((body as any)?.day || '').trim();
  const time_label = String((body as any)?.time_label || '').trim();
  const note = String((body as any)?.note || '').trim().slice(0, 500) || null;

  if (!day.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return NextResponse.json({ ok: false, error: 'Invalid day' }, { status: 400 });
  }
  if (parseTimeLabelToMinutes(time_label) == null) {
    return NextResponse.json({ ok: false, error: 'Invalid time' }, { status: 400 });
  }

  const q = sql();

  try {
    const rows = (await q`
      insert into lab_bookings (user_id, day, time_label, duration_min, status, note)
      values (${uid}, ${day}::date, ${time_label}, 60, 'requested', ${note})
      returning id, created_at, day, time_label, duration_min, status, note;
    `) as any[];

    return NextResponse.json({ ok: true, booking: rows?.[0] ?? null });
  } catch (e: any) {
    const msg = String(e?.message || 'Failed to create booking');
    if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('duplicate')) {
      return NextResponse.json({ ok: false, error: 'That slot is already booked. Please choose another time.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: 'Failed to create booking' }, { status: 500 });
  }
}
