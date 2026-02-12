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

function todayInNY(): string {
  // Treat “today” as America/New_York for consistency with other home widgets.
  // en-CA yields YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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

  const day = todayInNY();

  // “Auto” agenda items based on real logs.
  const [dailyStatsCount, progressPhotoCount, nutritionCount] = await Promise.all([
    q`select count(*)::int as count
      from lab_daily_stats
      where user_id = ${uid}
        and (created_at at time zone 'America/New_York')::date = ${day}::date;`,
    q`select count(*)::int as count
      from lab_progress_photos
      where user_id = ${uid}
        and (created_at at time zone 'America/New_York')::date = ${day}::date;`,
    q`select count(*)::int as count
      from lab_nutrition_log
      where user_id = ${uid}
        and (created_at at time zone 'America/New_York')::date = ${day}::date;`,
  ]);

  const habits = (await q`
    select
      h.id,
      h.name,
      h.sort_order,
      (hc.id is not null) as checked
    from lab_habits h
    left join lab_habit_checkins hc
      on hc.habit_id = h.id
      and hc.user_id = h.user_id
      and hc.day = ${day}::date
    where h.user_id = ${uid}
      and h.active = true
    order by h.sort_order asc, h.created_at asc;
  `) as any[];

  const planned = (await q`
    select id, day, time_label, title, type, action, sort_order, completed_at
    from lab_agenda_items
    where user_id = ${uid}
      and day = ${day}::date
    order by sort_order asc, created_at asc;
  `) as any[];

  const items: any[] = [];

  items.push({
    id: 'auto:daily-stats',
    title: 'Daily stats check-in',
    time: null,
    type: 'Check-in',
    action: 'quicklog',
    completed: Number(dailyStatsCount?.[0]?.count ?? 0) > 0,
  });

  items.push({
    id: 'auto:progress-photo',
    title: 'Progress photo',
    time: null,
    type: 'Check-in',
    action: 'progress_photos',
    completed: Number(progressPhotoCount?.[0]?.count ?? 0) > 0,
  });

  items.push({
    id: 'auto:nutrition',
    title: 'Log nutrition',
    time: null,
    type: 'Habit',
    action: 'nutrition',
    completed: Number(nutritionCount?.[0]?.count ?? 0) > 0,
  });

  for (const h of habits) {
    items.push({
      id: `habit:${h.id}`,
      title: h.name,
      time: null,
      type: 'Habit',
      action: 'habits',
      completed: Boolean(h.checked),
    });
  }

  for (const p of planned) {
    items.push({
      id: `planned:${p.id}`,
      title: p.title,
      time: p.time_label ?? null,
      type: p.type,
      action: p.action,
      completed: Boolean(p.completed_at),
    });
  }

  return NextResponse.json({ ok: true, day: 'today', items });
}
