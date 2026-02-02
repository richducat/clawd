import { NextResponse } from 'next/server';
import { ensureSchema, dbConfigured } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST() {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: false, error: 'Postgres not configured on this deployment' }, { status: 400 });
  }
  await ensureSchema();
  return NextResponse.json({ ok: true });
}
