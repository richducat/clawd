import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

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

  const habitsRows = (await q`
    select id, name, active, sort_order
    from lab_habits
    where user_id = ${uid} and active = true
    order by sort_order asc, created_at asc;
  `) as unknown as Array<{ id: number; name: string }>;

  const todayRows = (await q`select (now() at time zone 'America/New_York')::date as day;`) as unknown as Array<{ day: string }>;
  const day = String(todayRows?.[0]?.day || '');

  const checkinRows = (await q`
    select habit_id, checked
    from lab_habit_checkins
    where user_id = ${uid} and day = ${day}::date;
  `) as unknown as Array<{ habit_id: number; checked: boolean }>;

  const checkedByHabit = new Map<string, boolean>(checkinRows.map((c) => [String(c.habit_id), Boolean(c.checked)]));

  return NextResponse.json({
    ok: true,
    habits: habitsRows.map((h) => ({
      id: Number(h.id),
      name: String(h.name),
      checkedToday: checkedByHabit.get(String(h.id)) ?? false,
    })),
    day,
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

  const body = (await req.json().catch(() => null)) as { action?: string; habitId?: number; name?: string } | null;
  const action = body?.action;

  await ensureSchema();
  await getOrCreateUser(uid);

  const q = sql();
  const todayRows = (await q`select (now() at time zone 'America/New_York')::date as day;`) as unknown as Array<{ day: string }>;
  const day = String(todayRows?.[0]?.day || '');

  if (action === 'create') {
    const name = String(body?.name ?? '').trim();
    if (!name) return NextResponse.json({ ok: false, error: 'Missing name' }, { status: 400 });

    // place new habits at end
    const maxOrderRows = (await q`select coalesce(max(sort_order), 0) as max from lab_habits where user_id = ${uid};`) as unknown as Array<{ max: number }>;
    const sortOrder = Number(maxOrderRows?.[0]?.max ?? 0) + 1;

    const rows = (await q`
      insert into lab_habits (user_id, name, sort_order)
      values (${uid}, ${name}, ${sortOrder})
      returning id, name;
    `) as unknown as Array<{ id: number; name: string }>;

    return NextResponse.json({
      ok: true,
      habit: { id: Number(rows[0].id), name: String(rows[0].name), checkedToday: false },
      day,
    });
  }

  if (action === 'toggle') {
    const habitId = Number(body?.habitId);
    if (!Number.isFinite(habitId)) return NextResponse.json({ ok: false, error: 'Missing habitId' }, { status: 400 });

    // check current
    const existing = (await q`
      select id, checked
      from lab_habit_checkins
      where user_id = ${uid} and habit_id = ${habitId} and day = ${day}::date
      limit 1;
    `) as unknown as Array<{ id: number; checked: boolean }>;

    if (!existing?.[0]) {
      await q`
        insert into lab_habit_checkins (user_id, habit_id, day, checked)
        values (${uid}, ${habitId}, ${day}::date, true);
      `;
      return NextResponse.json({ ok: true, habitId, checkedToday: true, day });
    }

    const next = !Boolean(existing[0].checked);
    await q`update lab_habit_checkins set checked = ${next} where id = ${existing[0].id};`;
    return NextResponse.json({ ok: true, habitId, checkedToday: next, day });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
