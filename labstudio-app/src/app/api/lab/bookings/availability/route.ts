import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { neon } from '@neondatabase/serverless';
import { ensureBookingSchema, minutesToTimeLabel, parseTimeLabelToMinutes } from '../_schema';

export const runtime = 'nodejs';

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

function fmtDay(d: Date): string {
  // YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function dayOfWeekInNY(d: Date): number {
  // 0=Sun..6=Sat using NY calendar day
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).formatToParts(d);
  const wd = parts.find((p) => p.type === 'weekday')?.value || '';
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? d.getUTCDay();
}

export async function GET(req: Request) {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: false, error: 'DATABASE_URL not configured' }, { status: 400 });
  }

  const url = new URL(req.url);
  const days = Math.max(1, Math.min(14, Number(url.searchParams.get('days') || 7)));

  const jar = await cookies();
  const uid = jar.get('labstudio_uid')?.value;
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'Missing labstudio_uid cookie' }, { status: 401 });
  }

  await ensureSchema();
  await getOrCreateUser(uid);
  await ensureBookingSchema();

  const q = sql();
  const windows = (await q`
    select day_of_week, start_time, end_time, slot_minutes
    from lab_booking_windows
    where active = true
    order by day_of_week asc, start_time asc;
  `) as any[];

  const byDow = new Map<number, Array<{ start: number; end: number; step: number }>>();
  for (const w of windows) {
    const s = parseTimeLabelToMinutes(String(w.start_time));
    const e = parseTimeLabelToMinutes(String(w.end_time));
    const step = Math.max(15, Math.min(180, Number(w.slot_minutes || 60)));
    if (s == null || e == null || e <= s) continue;
    const dow = Number(w.day_of_week);
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow)!.push({ start: s, end: e, step });
  }

  // Pull booked slots in the visible range.
  const startDay = fmtDay(new Date());
  const endDay = fmtDay(new Date(Date.now() + (days + 1) * 24 * 60 * 60 * 1000));

  const booked = (await q`
    select day, time_label, status
    from lab_bookings
    where day >= ${startDay}::date
      and day <= ${endDay}::date
      and status <> 'cancelled';
  `) as any[];

  const bookedSet = new Set(booked.map((b) => `${String(b.day).slice(0, 10)}|${String(b.time_label)}`));

  const out: Array<{ day: string; slots: Array<{ time_label: string; available: boolean }> }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    const day = fmtDay(d);
    const dow = dayOfWeekInNY(d);
    const windowsForDay = byDow.get(dow) || [];

    const slots: Array<{ time_label: string; available: boolean }> = [];
    for (const win of windowsForDay) {
      for (let t = win.start; t + win.step <= win.end; t += win.step) {
        const label = minutesToTimeLabel(t);
        const key = `${day}|${label}`;
        const available = !bookedSet.has(key);
        slots.push({ time_label: label, available });
      }
    }

    out.push({ day, slots });
  }

  return NextResponse.json({ ok: true, availability: out });
}
