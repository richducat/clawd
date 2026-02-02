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
}

export async function getOrCreateUser(userId: string): Promise<LabUser> {
  await ensureSchema();
  const q = sql();

  const existing = await q<LabUser[]>`select * from lab_users where id = ${userId} limit 1;`;
  if (existing?.[0]) return existing[0];

  const inserted = await q<LabUser[]>`
    insert into lab_users (id, display_name, xp, level)
    values (${userId}, 'YOU', 1250, 3)
    returning *;
  `;
  return inserted[0];
}
