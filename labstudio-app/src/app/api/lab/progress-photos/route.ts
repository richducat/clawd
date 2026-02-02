import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser } from '@/lib/db';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

type Body = {
  imageDataUrl?: string;
  note?: string;
};

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
  const rows = (await q`
    select id, created_at, note
    from lab_progress_photos
    where user_id = ${uid}
    order by created_at desc
    limit 20;
  `) as any[];

  return NextResponse.json({ ok: true, photos: rows });
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

  const body = (await req.json().catch(() => ({}))) as Body;
  const imageDataUrl = body.imageDataUrl || '';
  if (!imageDataUrl.startsWith('data:image/')) {
    return NextResponse.json({ ok: false, error: 'Expected data:image/* data URL' }, { status: 400 });
  }
  if (imageDataUrl.length > 1_500_000) {
    return NextResponse.json({ ok: false, error: 'Image too large (max ~1.5MB data URL)' }, { status: 400 });
  }

  const note = body.note?.slice(0, 2000) ?? null;

  await ensureSchema();
  await getOrCreateUser(uid);

  const q = sql();
  const rows = (await q`
    insert into lab_progress_photos (user_id, image_data_url, note)
    values (${uid}, ${imageDataUrl}, ${note})
    returning id, created_at;
  `) as any[];

  return NextResponse.json({ ok: true, saved: rows?.[0] ?? null });
}
