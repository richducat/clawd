import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { TOBY_SYSTEM_PROMPT } from '@/lib/toby-protocol';
import {
  currentEtDayKey,
  getRateLimitCookieName,
  makeSignedDailyCounterCookie,
  parseAndVerifyDailyCounter,
} from '@/lib/rate-limit';

export const runtime = 'nodejs';

const DAILY_LIMIT = 35;

export async function POST(req: Request) {
  try {
    const { message } = (await req.json().catch(() => ({}))) as { message?: string };
    const text = String(message || '').trim();

    if (!text) {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
    }

    const secret = process.env.LABSTUDIO_SESSION_SECRET;

    // Daily cap (no DB): signed cookie counter, resets daily (ET).
    // If no secret is configured, we skip rate limiting instead of breaking chat.
    const jar = await cookies();
    const rlName = getRateLimitCookieName();
    const currentDay = currentEtDayKey();
    const parsed = secret
      ? parseAndVerifyDailyCounter(jar.get(rlName)?.value, secret)
      : { day: currentDay, count: 0, ok: false };
    const count = parsed.day === currentDay ? parsed.count : 0;

    if (secret && count >= DAILY_LIMIT) {
      return NextResponse.json(
        {
          error: `Daily limit reached (${DAILY_LIMIT}/day). Try again tomorrow.`,
          limit: DAILY_LIMIT,
          day: currentDay,
        },
        { status: 429 },
      );
    }

    // Default to a cost-effective model; override via TOBY_MODEL env.
    const model = process.env.TOBY_MODEL || 'gpt-4.1-mini';

    // Use OpenAI Responses API (recommended modern endpoint).
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
        // Keep it short for cost control.
        max_output_tokens: 220,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: json?.error?.message || 'OpenAI error', detail: json },
        { status: 502 },
      );
    }

    // Extract text from responses output.
    const output = json?.output ?? [];
    const parts: string[] = [];
    for (const item of output) {
      const content = item?.content || [];
      for (const c of content) {
        if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
      }
    }
    const reply = parts.join('\n').trim() || '(no response)';

    // Increment counter only on successful OpenAI call.
    const nextCount = count + 1;
    if (secret) {
      jar.set(rlName, makeSignedDailyCounterCookie({ day: currentDay, count: nextCount }, secret), {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 60 * 60 * 24 * 2,
      });
    }

    return NextResponse.json({ reply, usage: { day: currentDay, count: nextCount, limit: DAILY_LIMIT } });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    );
  }
}
