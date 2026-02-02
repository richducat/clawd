import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConfigured, ensureSchema, getOrCreateUser, getUserProfile } from '@/lib/db';
import { neon } from '@neondatabase/serverless';
import { TOBY_SYSTEM_PROMPT } from '@/lib/toby-protocol';

export const runtime = 'nodejs';

type GenerateBody = {
  action: 'generate';
};

type PinBody = {
  action: 'pin';
  id: number;
};

type UnpinBody = {
  action: 'unpin';
};

type Body = GenerateBody | PinBody | UnpinBody;

function sql() {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

async function mustUid() {
  const jar = await cookies();
  const uid = jar.get('labstudio_uid')?.value;
  if (!uid) throw new Error('Missing labstudio_uid cookie');
  return uid;
}

async function getPinnedAndHistory(uid: string) {
  const q = sql();
  const pinned = (await q`
    select id, created_at, text, pinned, pinned_at
    from lab_coach_focus
    where user_id = ${uid} and pinned = true
    order by pinned_at desc
    limit 1;
  `) as any[];

  const history = (await q`
    select id, created_at, text, pinned, pinned_at
    from lab_coach_focus
    where user_id = ${uid}
    order by created_at desc
    limit 12;
  `) as any[];

  return { pinned: pinned?.[0] ?? null, history };
}

export async function GET() {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: false, error: 'DATABASE_URL not configured' }, { status: 400 });
  }

  let uid: string;
  try {
    uid = await mustUid();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  await ensureSchema();
  await getOrCreateUser(uid);

  const { pinned, history } = await getPinnedAndHistory(uid);
  return NextResponse.json({ ok: true, pinned, history });
}

export async function POST(req: Request) {
  if (!dbConfigured()) {
    return NextResponse.json({ ok: false, error: 'DATABASE_URL not configured' }, { status: 400 });
  }

  let uid: string;
  try {
    uid = await mustUid();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<Body>;
  const action = body?.action;

  await ensureSchema();
  await getOrCreateUser(uid);

  const q = sql();

  if (action === 'pin') {
    const id = Number((body as PinBody).id);
    if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });

    await q`update lab_coach_focus set pinned = false where user_id = ${uid};`;
    await q`update lab_coach_focus set pinned = true, pinned_at = now() where user_id = ${uid} and id = ${id};`;

    const { pinned, history } = await getPinnedAndHistory(uid);
    return NextResponse.json({ ok: true, pinned, history });
  }

  if (action === 'unpin') {
    await q`update lab_coach_focus set pinned = false where user_id = ${uid};`;
    const { pinned, history } = await getPinnedAndHistory(uid);
    return NextResponse.json({ ok: true, pinned, history });
  }

  if (action !== 'generate') {
    return NextResponse.json({ ok: false, error: 'Invalid action' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  const profile = await getUserProfile(uid);

  const recentFocus = (await q`
    select text
    from lab_coach_focus
    where user_id = ${uid}
    order by created_at desc
    limit 5;
  `) as any[];

  const focusMemory = recentFocus.map((r) => String(r.text || '')).filter(Boolean);

  const prompt = `Create ONE "Today’s Focus" card for the user.

Requirements:
- 3–6 short bullet points max.
- Use Toby voice (coach-like). No sympathy filler.
- Tie mechanics → performance.
- Include ONE specific action they can do today.
- If user has no profile, ask them to finish onboarding.

User profile:
${profile ? JSON.stringify({ first_name: profile.first_name, last_name: profile.last_name, goal: profile.goal, activity_level: profile.activity_level, schedule_days: profile.schedule_days, injuries_json: profile.injuries_json }, null, 2) : 'NONE'}

Recent prior focus cards (memory):
${focusMemory.length ? focusMemory.map((t, i) => `(${i + 1}) ${t}`).join('\n\n') : 'NONE'}

Return plain text only.`;

  const model = process.env.TOBY_MODEL || 'gpt-4.1-mini';

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: TOBY_SYSTEM_PROMPT },
        { role: 'user', content: prompt.slice(0, 7000) },
      ],
      max_output_tokens: 280,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: json?.error?.message || 'OpenAI error', detail: json }, { status: 502 });
  }

  const output = json?.output ?? [];
  const parts: string[] = [];
  for (const item of output) {
    const content = item?.content || [];
    for (const c of content) {
      if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  const text = parts.join('\n').trim();

  if (!text) return NextResponse.json({ ok: false, error: 'Empty response' }, { status: 502 });

  const inserted = (await q`
    insert into lab_coach_focus (user_id, text, pinned)
    values (${uid}, ${text.slice(0, 5000)}, false)
    returning id, created_at, text, pinned, pinned_at;
  `) as any[];

  const { pinned, history } = await getPinnedAndHistory(uid);

  return NextResponse.json({ ok: true, generated: inserted?.[0] ?? null, pinned, history });
}
