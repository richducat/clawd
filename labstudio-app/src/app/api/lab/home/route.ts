import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser, getUserProfile } from '@/lib/db';
import { neon } from '@neondatabase/serverless';
import { parseICS } from 'ical';

export const runtime = 'nodejs';

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

async function fetchIcalEvents() {
  const icalUrl = process.env.LABSTUDIO_BOOKINGS_ICAL_URL;
  if (!icalUrl) return [];

  const res = await fetch(icalUrl, {
    headers: {
      'user-agent': 'labstudio-app/1.0',
      accept: 'text/calendar,*/*',
    },
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
      location: e.location ? String(e.location) : null,
      description: e.description ? String(e.description) : null,
    }))
    .filter((e) => e.start && e.end);
}

async function getNextBooking() {
  const now = new Date();
  const events = await fetchIcalEvents();

  const upcoming = events
    .filter((e) => e.start && e.start.getTime() > now.getTime())
    .sort((a, b) => a.start!.getTime() - b.start!.getTime());

  return upcoming[0] ?? null;
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
  const profile = await getUserProfile(uid);

  // Latest daily stats
  const stats = (await q`
    select id, created_at, weight_lbs, body_fat_pct, resting_hr, note
    from lab_daily_stats
    where user_id = ${uid}
    order by created_at desc
    limit 1;
  `) as any[];

  // Today's nutrition totals (America/New_York)
  const nutrition = (await q`
    select
      coalesce(sum(protein_g), 0) as protein_g,
      coalesce(sum(carbs_g), 0) as carbs_g,
      coalesce(sum(fat_g), 0) as fat_g
    from lab_nutrition_log
    where user_id = ${uid}
      and (created_at at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date;
  `) as any[];

  const n = nutrition?.[0] ?? { protein_g: 0, carbs_g: 0, fat_g: 0 };
  const cals = Number(n.protein_g) * 4 + Number(n.carbs_g) * 4 + Number(n.fat_g) * 9;

  // Workout summary (last 7d)
  const workouts7d = (await q`
    select count(*)::int as completed
    from lab_workout_log
    where user_id = ${uid}
      and created_at >= (now() - interval '7 days');
  `) as any[];

  // Progress photos count (last 30d)
  const photos30d = (await q`
    select count(*)::int as count
    from lab_progress_photos
    where user_id = ${uid}
      and created_at >= (now() - interval '30 days');
  `) as any[];

  // Nutrition 7d avg calories (America/New_York)
  const nutrition7d = (await q`
    select
      (coalesce(sum(protein_g), 0) * 4 + coalesce(sum(carbs_g), 0) * 4 + coalesce(sum(fat_g), 0) * 9) as calories
    from lab_nutrition_log
    where user_id = ${uid}
      and (created_at at time zone 'America/New_York')::date >= ((now() at time zone 'America/New_York')::date - 6);
  `) as any[];

  // Latest PR
  const latestPr = (await q`
    select id, created_at, lift, value, unit, reps
    from lab_strength_prs
    where user_id = ${uid}
    order by created_at desc
    limit 1;
  `) as any[];

  // iCal-based session counts
  const icsEvents = await fetchIcalEvents();
  const now = new Date();
  const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const bookedUpcoming30d = icsEvents.filter((e) => e.start && e.start > now && e.start < in30d).length;
  const bookedPast30d = icsEvents.filter((e) => e.start && e.start < now && e.start > last30d).length;

  const completed7d = Number(workouts7d?.[0]?.completed ?? 0);
  const missedApprox30d = Math.max(bookedPast30d - completed7d, 0);

  const upcomingBookings = icsEvents
    .filter((e) => e.start && e.start > now && e.start < in30d)
    .sort((a, b) => a.start!.getTime() - b.start!.getTime())
    .slice(0, 5);

  const nextBooking = await getNextBooking();

  const recentWorkouts = (await q`
    select id, created_at, kind, duration_min, note
    from lab_workout_log
    where user_id = ${uid}
      and created_at >= (now() - interval '7 days')
    order by created_at desc
    limit 10;
  `) as any[];

  const calories7dTotal = Number(nutrition7d?.[0]?.calories ?? 0);
  const calories7dAvg = Math.round(calories7dTotal / 7);

  return NextResponse.json({
    ok: true,
    home: {
      profile,
      nutrition: { protein_g: Number(n.protein_g), carbs_g: Number(n.carbs_g), fat_g: Number(n.fat_g), calories: cals },
      latestStats: stats?.[0] ?? null,
      nextBooking,
      upcomingBookings,
      recentWorkouts,
      sessionLog: {
        bookedUpcoming30d,
        completed7d,
        missedApprox30d,
      },
      progress: {
        photos30d: Number(photos30d?.[0]?.count ?? 0),
        calories7dAvg,
        latestPr: latestPr?.[0] ?? null,
      },
    },
  });
}
