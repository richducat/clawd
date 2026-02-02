import { NextResponse } from 'next/server';
import { TOBY_SYSTEM_PROMPT } from '@/lib/toby-protocol';

export const runtime = 'nodejs';

const ALLOW_ORIGIN = 'https://labstudio.fit';

function corsHeaders(origin: string | null) {
  const o = origin === ALLOW_ORIGIN ? origin : ALLOW_ORIGIN;
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-labstudio-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get('origin');
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');

  // Only accept browser calls from marketing origin.
  if (origin && origin !== ALLOW_ORIGIN) {
    return NextResponse.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: corsHeaders(origin) },
    );
  }

  const requiredKey = process.env.LABSTUDIO_ACCESS_CODE;
  const providedKey = req.headers.get('x-labstudio-key');

  if (!requiredKey) {
    return NextResponse.json(
      { error: 'Server not configured (LABSTUDIO_ACCESS_CODE missing)' },
      { status: 500, headers: corsHeaders(origin) },
    );
  }

  if (!providedKey || providedKey !== requiredKey) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: corsHeaders(origin) },
    );
  }

  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  const text = String(message || '').trim();
  if (!text) {
    return NextResponse.json(
      { error: 'Missing message' },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured' },
      { status: 500, headers: corsHeaders(origin) },
    );
  }

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
        { role: 'user', content: text.slice(0, 2000) },
      ],
      max_output_tokens: 220,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: json?.error?.message || 'OpenAI error', detail: json },
      { status: 502, headers: corsHeaders(origin) },
    );
  }

  const output = json?.output ?? [];
  const parts: string[] = [];
  for (const item of output) {
    const content = item?.content || [];
    for (const c of content) {
      if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  const reply = parts.join('\n').trim() || '(no response)';

  return NextResponse.json({ reply }, { headers: corsHeaders(origin) });
}
