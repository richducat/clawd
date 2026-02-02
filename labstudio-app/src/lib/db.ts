import { sql } from '@vercel/postgres';

export function dbConfigured() {
  // Vercel Postgres typically provides POSTGRES_URL or POSTGRES_URL_NON_POOLING
  return Boolean(process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING);
}

export async function ensureSchema() {
  // Idempotent schema init.
  await sql`
    create table if not exists lab_users (
      id text primary key,
      created_at timestamptz not null default now(),
      display_name text,
      xp integer not null default 0,
      level integer not null default 1
    );
  `;
}

export async function getOrCreateUser(userId: string) {
  await ensureSchema();
  const existing = await sql`select * from lab_users where id = ${userId} limit 1;`;
  if (existing.rows?.[0]) return existing.rows[0];

  const inserted = await sql`
    insert into lab_users (id, display_name, xp, level)
    values (${userId}, 'YOU', 1250, 3)
    returning *;
  `;
  return inserted.rows[0];
}
