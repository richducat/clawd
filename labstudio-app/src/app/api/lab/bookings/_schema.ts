import { neon } from '@neondatabase/serverless';

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

export async function ensureBookingSchema() {
  const q = sql();

  await q`
    create table if not exists lab_booking_windows (
      id bigserial primary key,
      day_of_week integer not null, -- 0=Sun..6=Sat
      start_time text not null, -- HH:MM (local ET)
      end_time text not null,   -- HH:MM (local ET)
      slot_minutes integer not null default 60,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await q`create index if not exists lab_booking_windows_active_idx on lab_booking_windows(active, day_of_week);`;
  await q`create unique index if not exists lab_booking_windows_unique_slot_idx on lab_booking_windows(day_of_week, start_time, end_time);`;

  await q`
    create table if not exists lab_bookings (
      id bigserial primary key,
      user_id text not null references lab_users(id) on delete cascade,
      created_at timestamptz not null default now(),
      day date not null,
      time_label text not null, -- HH:MM (local ET)
      duration_min integer not null default 60,
      status text not null default 'requested',
      note text
    );
  `;

  // Older deployments used a table-level unique(day, time_label) constraint.
  // Replace it with a partial unique index so cancelled slots can be rebooked.
  await q`alter table lab_bookings drop constraint if exists lab_bookings_day_time_label_key;`;
  await q`
    create unique index if not exists lab_bookings_active_slot_uniq
      on lab_bookings(day, time_label)
      where status <> 'cancelled';
  `;

  await q`create index if not exists lab_bookings_user_day_idx on lab_bookings(user_id, day desc, time_label);`;

  // Seed defaults idempotently so concurrent first-run requests do not duplicate windows.
  const seed: Array<{ dow: number; start: string; end: string; mins: number }> = [
    { dow: 1, start: '07:00', end: '19:00', mins: 60 },
    { dow: 2, start: '07:00', end: '19:00', mins: 60 },
    { dow: 3, start: '07:00', end: '19:00', mins: 60 },
    { dow: 4, start: '07:00', end: '19:00', mins: 60 },
    { dow: 5, start: '07:00', end: '19:00', mins: 60 },
    { dow: 6, start: '09:00', end: '13:00', mins: 60 },
  ];

  for (const s of seed) {
    await q`
      insert into lab_booking_windows (day_of_week, start_time, end_time, slot_minutes, active)
      values (${s.dow}, ${s.start}, ${s.end}, ${s.mins}, true)
      on conflict (day_of_week, start_time, end_time) do nothing;
    `;
  }
}

export function parseTimeLabelToMinutes(label: string): number | null {
  const m = String(label || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToTimeLabel(total: number): string {
  const h = Math.floor(total / 60);
  const min = total % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
