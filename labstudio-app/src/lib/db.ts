import { neon } from '@neondatabase/serverless';

type LabUser = {
  id: string;
  created_at: string;
  display_name: string | null;
  xp: number;
  level: number;
};

function dbUrl() {
  return process.env.DATABASE_URL || '';
}

export function dbConfigured() {
  return Boolean(dbUrl());
}

function sql() {
  const url = dbUrl();
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

export async function ensureSchema() {
  const q = sql();
  await q`
    create table if not exists lab_users (
      id text primary key,
      created_at timestamptz not null default now(),
      display_name text,
      xp integer not null default 0,
      level integer not null default 1
    );
  `;

  await q`
    create table if not exists lab_daily_stats (
      id bigserial primary key,
      user_id text not null references lab_users(id) on delete cascade,
      created_at timestamptz not null default now(),
      weight_lbs numeric,
      body_fat_pct numeric,
      note text
    );
  `;

  await q`
    create index if not exists lab_daily_stats_user_created_at_idx on lab_daily_stats(user_id, created_at desc);
  `;

  await q`
    create table if not exists lab_nutrition_log (
      id bigserial primary key,
      user_id text not null references lab_users(id) on delete cascade,
      created_at timestamptz not null default now(),
      name text not null,
      protein_g integer not null,
      carbs_g integer not null,
      fat_g integer not null,
      time_label text
    );
  `;

  await q`
    create index if not exists lab_nutrition_log_user_created_at_idx on lab_nutrition_log(user_id, created_at desc);
  `;
}

export async function getOrCreateUser(userId: string): Promise<LabUser> {
  await ensureSchema();
  const q = sql();

  const existing = (await q`select * from lab_users where id = ${userId} limit 1;`) as unknown as LabUser[];
  if (existing?.[0]) return existing[0];

  const inserted = (await q`
    insert into lab_users (id, display_name, xp, level)
    values (${userId}, 'YOU', 1250, 3)
    returning *;
  `) as unknown as LabUser[];
  return inserted[0];
}
