import { NextResponse } from 'next/server';
import { TOBY_SYSTEM_PROMPT } from '@/lib/toby-protocol';

export const runtime = 'nodejs';

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

    const model = process.env.TOBY_MODEL || 'gpt-4.1';

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
          { role: 'user', content: text },
        ],
        // Keep it short for v1.
        max_output_tokens: 350,
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

    return NextResponse.json({ reply });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    );
  }
}
