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
    const { message, history } = (await req.json().catch(() => ({}))) as {
      message?: string;
      history?: Array<{ role: 'user' | 'assistant'; text: string }>;
    };
    const text = String(message || '').trim();

    const safeHistory = Array.isArray(history) ? history : [];
    const lastUser = [...safeHistory].reverse().find((m) => m?.role === 'user')?.text;
    const effectiveText = (lastUser ? String(lastUser) : text).trim();

    if (!effectiveText) {
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

    const TRIAGE_RE = /(sharp|pinch|pain|hurt|tweak|pop|numb|tingl|shooting|joint|injur|leg press|squat|deadlift|bench|machine|right now)/i;
    // Keep triage "sticky" across short back-and-forths.
    // Example: user answers "left side" or "deep" next turn—still triage.
    const triageInHistory = safeHistory.some((m) => TRIAGE_RE.test(String(m?.text || '')));
    const menuInHistory = safeHistory.some((m) => m?.role === 'assistant' && /\bmenu\s*:/i.test(String(m?.text || '')));
    const isTriage = TRIAGE_RE.test(effectiveText) || triageInHistory || menuInHistory;

    const mappedHistory = safeHistory
      .slice(-10)
      .map((m) => ({ role: m.role, content: String(m.text || '').slice(0, 800) }))
      .filter((m) => m.content.trim().length);

    const input = [{ role: 'system', content: TOBY_SYSTEM_PROMPT }, ...mappedHistory];
    if (!mappedHistory.length || mappedHistory[mappedHistory.length - 1]?.role !== 'user') {
      input.push({ role: 'user', content: effectiveText.slice(0, 2000) });
    }

    // Use OpenAI Responses API (recommended modern endpoint).
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input,
        max_output_tokens: isTriage ? 320 : 220,
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
    let reply = parts.join('\n').trim() || '(no response)';

    // Guardrail: keep the Stage 1 check-in contract for normal coaching,
    // but do NOT force it during in-workout pain triage.
    if (!isTriage) {
      const contract = `Check in tomorrow with:\n- Joint pain: yes/no\n- Muscle soreness: 0–10\n- Energy: 0–10`;
      const normalized = reply.toLowerCase();
      if (!normalized.includes('check in tomorrow')) {
        reply = `${reply}\n\n${contract}`.trim();
      }
    } else {
      // If the model accidentally adds the daily tracking footer during triage, strip it.
      // (We still want concise menus + stop criteria in triage.)
      reply = reply
        .replace(/\n\s*Next:[\s\S]*$/i, '')
        .replace(/\n\s*Track:[\s\S]*$/i, '')
        .replace(/\n\s*Check in tomorrow with:[\s\S]*$/i, '')
        .trim();
    }

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
