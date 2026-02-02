'use client';

import { useMemo, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; text: string };

export default function TobyCoachView() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      text: "I’m Toby. What are we working on today?",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    setBusy(true);
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);

    try {
      const history = [...messages, { role: 'user' as const, text }].slice(-10);
      const res = await fetch('/api/toby/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Request failed');
      setMessages((m) => [...m, { role: 'assistant', text: String(json.reply || '') }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: `Error: ${e instanceof Error ? e.message : 'unknown error'}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-bold text-zinc-500 tracking-widest uppercase">AI Coach</div>
        <div className="text-2xl font-black italic uppercase">TOBY</div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-zinc-900/60 backdrop-blur-md p-4 h-[60vh] overflow-auto">
        {messages.map((m, i) => (
          <div key={i} className="mb-3">
            <div
              className={`text-[10px] font-black tracking-widest ${
                m.role === 'assistant' ? 'text-emerald-400' : 'text-white'
              }`}
            >
              {m.role === 'assistant' ? 'TOBY' : 'YOU'}
            </div>
            <div className="whitespace-pre-wrap text-zinc-200 leading-relaxed">{m.text}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message Toby…"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          className="bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-xl px-4 disabled:opacity-50"
          onClick={() => void send()}
          disabled={!canSend}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>

      <div className="text-[11px] text-zinc-500">
        Toby runs server-side on app.labstudio.fit (OpenAI). No long-term memory yet.
      </div>
    </div>
  );
}
