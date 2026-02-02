import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { neon } from '@neondatabase/serverless';
import { parseICS } from 'ical';

export const runtime = 'nodejs';

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

async function getNextBooking() {
  const icalUrl = process.env.LABSTUDIO_BOOKINGS_ICAL_URL;
  if (!icalUrl) return null;

  const res = await fetch(icalUrl, {
    headers: {
      'user-agent': 'labstudio-app/1.0',
      accept: 'text/calendar,*/*',
    },
    // avoid caching so new bookings show up quickly
    cache: 'no-store',
  });
  if (!res.ok) return null;

  const icsText = await res.text();
  const data = parseICS(icsText) as any;
  const now = new Date();

  const events = Object.values(data || {}).filter((v: any) => v && v.type === 'VEVENT') as any[];

  const upcoming = events
    .map((e) => ({
      summary: String(e.summary ?? ''),
      start: e.start ? new Date(e.start) : null,
      end: e.end ? new Date(e.end) : null,
      location: e.location ? String(e.location) : null,
      description: e.description ? String(e.description) : null,
    }))
    .filter((e) => e.start && e.start.getTime() > now.getTime())
    .sort((a, b) => (a.start!.getTime() - b.start!.getTime()));

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

  // Latest daily stats
  const stats = (await q`
    select id, created_at, weight_lbs, body_fat_pct, note
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

  const nextBooking = await getNextBooking();

  return NextResponse.json({
    ok: true,
    home: {
      nutrition: { protein_g: Number(n.protein_g), carbs_g: Number(n.carbs_g), fat_g: Number(n.fat_g), calories: cals },
      latestStats: stats?.[0] ?? null,
      nextBooking,
    },
  });
}
