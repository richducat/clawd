import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  dbConfigured,
  ensureSchema,
  getOrCreateUser,
  getUserProfile,
  markOnboardingComplete,
  upsertUserProfile,
} from '@/lib/db';

export const runtime = 'nodejs';

function normalizeScheduleDays(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((d) => String(d).trim())
    .filter(Boolean)
    .slice(0, 7);
}

function normalizeInjuriesJson(v: unknown): unknown {
  // We store this as jsonb. Keep it reasonably structured.
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof v === 'string') {
    const parts = v
      .split(/\n|,/g)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts;
  }
  if (typeof v === 'object') return v;
  return [];
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
  const user = await getOrCreateUser(uid);
  const profile = await getUserProfile(uid);

  return NextResponse.json({ ok: true, onboarding_complete: user.onboarding_complete || Boolean(profile), profile });
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

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  await ensureSchema();
  await getOrCreateUser(uid);

  const profile = await upsertUserProfile(uid, {
    first_name: typeof b.first_name === 'string' ? b.first_name : null,
    last_name: typeof b.last_name === 'string' ? b.last_name : null,
    email: typeof b.email === 'string' ? b.email : null,
    phone: typeof b.phone === 'string' ? b.phone : null,
    goal: typeof b.goal === 'string' ? b.goal : null,
    activity_level: typeof b.activity_level === 'string' ? b.activity_level : null,
    schedule_days: normalizeScheduleDays(b.schedule_days),
    nutrition_rating:
      b.nutrition_rating == null
        ? null
        : Number.isFinite(Number(b.nutrition_rating))
          ? Number(b.nutrition_rating)
          : null,
    injuries_json: normalizeInjuriesJson(b.injuries_json),
  });

  await markOnboardingComplete(uid);

  return NextResponse.json({ ok: true, profile, onboarding_complete: true });
}
