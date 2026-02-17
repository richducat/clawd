import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { parseICS } from 'ical';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';

export const runtime = 'nodejs';

type BookingStatus = 'requested' | 'confirmed' | 'canceled';

type BookingRow = {
  id: string;
  user_id: string;
  start_at: string;
  end_at: string;
  kind: string;
  status: BookingStatus;
  note: string | null;
  created_at: string;
};

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

async function fetchIcalEvents(): Promise<Array<{ summary: string; start: Date; end: Date }>> {
  const icalUrl = process.env.LABSTUDIO_BOOKINGS_ICAL_URL;
  if (!icalUrl) return [];

  const res = await fetch(icalUrl, {
    headers: { 'user-agent': 'labstudio-app/1.0', accept: 'text/calendar,*/*' },
    cache: 'no-store',
  });
  if (!res.ok) return [];

  const icsText = await res.text();
  const data = parseICS(icsText) as any;
  const events = Object.values(data || {}).filter((v: any) => v && v.type === 'VEVENT') as any[];

  return events
    .map((e) => ({
      summary: String(e.summary ?? ''),
      start: e.start ? new Date(e.start) : null,
      end: e.end ? new Date(e.end) : null,
    }))
    .filter((e) => e.start && e.end) as any;
}

function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
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

  await q`
    create table if not exists lab_bookings (
      id text primary key,
      user_id text not null references lab_users(id) on delete cascade,
      start_at timestamptz not null,
      end_at timestamptz not null,
      kind text not null default 'session',
      status text not null default 'requested',
      note text,
      created_at timestamptz not null default now(),
      canceled_at timestamptz
    );
  `;
  await q`create index if not exists lab_bookings_user_start_idx on lab_bookings(user_id, start_at asc);`;
  await q`create index if not exists lab_bookings_start_idx on lab_bookings(start_at asc);`;

  // Upcoming bookings in DB (all users, used as busy slots)
  const rows = (await q`
    select id, user_id, start_at, end_at, kind, status, note, created_at
    from lab_bookings
    where status in ('requested','confirmed')
      and end_at > now() - interval '1 hour'
    order by start_at asc
    limit 200;
  `) as any[];

  const dbBookings = rows.map((r) => ({
    id: String(r.id),
    user_id: String(r.user_id),
    start_at: new Date(r.start_at).toISOString(),
    end_at: new Date(r.end_at).toISOString(),
    kind: String(r.kind ?? 'session'),
    status: (String(r.status ?? 'requested') as BookingStatus) || 'requested',
    note: r.note ? String(r.note) : null,
    created_at: new Date(r.created_at).toISOString(),
    source: 'db' as const,
  }));

  const ics = await fetchIcalEvents();
  const icsBookings = ics
    .filter((e) => e.end.getTime() > Date.now() - 60 * 60 * 1000)
    .slice(0, 200)
    .map((e) => ({
      id: `ical:${e.start.toISOString()}:${e.end.toISOString()}:${e.summary}`,
      user_id: 'calendar',
      start_at: e.start.toISOString(),
      end_at: e.end.toISOString(),
      kind: e.summary || 'session',
      status: 'confirmed' as const,
      note: null,
      created_at: e.start.toISOString(),
      source: 'ical' as const,
    }));

  const mine = dbBookings.filter((b) => b.user_id === uid);

  return NextResponse.json({
    ok: true,
    mine,
    busy: [...dbBookings, ...icsBookings],
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

  await ensureSchema();
  await getOrCreateUser(uid);

  const body = (await req.json().catch(() => ({}))) as any;
  const startRaw = String(body?.start_at || '').trim();
  const endRaw = String(body?.end_at || '').trim();
  const kind = String(body?.kind || 'session').trim() || 'session';
  const note = body?.note != null ? String(body.note).slice(0, 500) : null;

  const start = new Date(startRaw);
  const end = new Date(endRaw);

  if (!startRaw || !endRaw || isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ ok: false, error: 'Invalid start/end' }, { status: 400 });
  }

  const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
  if (durationMin <= 0 || durationMin > 120) {
    return NextResponse.json({ ok: false, error: 'Invalid duration' }, { status: 400 });
  }

  if (start.getTime() < Date.now() - 5 * 60 * 1000) {
    return NextResponse.json({ ok: false, error: 'Booking must be in the future' }, { status: 400 });
  }

  const q = sql();

  await q`
    create table if not exists lab_bookings (
      id text primary key,
      user_id text not null references lab_users(id) on delete cascade,
      start_at timestamptz not null,
      end_at timestamptz not null,
      kind text not null default 'session',
      status text not null default 'requested',
      note text,
      created_at timestamptz not null default now(),
      canceled_at timestamptz
    );
  `;

  // Prevent overlaps with DB-backed bookings.
  const overlaps = (await q`
    select id, start_at, end_at
    from lab_bookings
    where status in ('requested','confirmed')
      and start_at < ${end.toISOString()}::timestamptz
      and end_at > ${start.toISOString()}::timestamptz
    limit 1;
  `) as any[];

  if (overlaps?.[0]) {
    return NextResponse.json({ ok: false, error: 'That time is no longer available. Please pick another slot.' }, { status: 409 });
  }

  // Best-effort overlap prevention vs iCal feed.
  try {
    const ics = await fetchIcalEvents();
    const hit = ics.find((e) => overlap(start, end, e.start, e.end));
    if (hit) {
      return NextResponse.json({ ok: false, error: 'That time overlaps an existing booking. Please pick another slot.' }, { status: 409 });
    }
  } catch {
    // If calendar feed is down, still allow DB booking.
  }

  const id = crypto.randomUUID();

  const inserted = (await q`
    insert into lab_bookings (id, user_id, start_at, end_at, kind, status, note)
    values (${id}, ${uid}, ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, ${kind}, 'requested', ${note})
    returning id, user_id, start_at, end_at, kind, status, note, created_at;
  `) as any[];

  const row = inserted?.[0] as BookingRow | undefined;
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Failed to create booking' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, booking: row });
}
