'use client';

import { useMemo, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; text: string };

export default function MembersChat() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      text: "I’m Toby. Tell me what you’re trying to improve right now (sleep, strength, body comp, stress, consistency) and what’s getting in the way.",
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
    <div style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 14,
          minHeight: 360,
          maxHeight: 520,
          overflow: 'auto',
          background: 'var(--panel)',
        }}
      >
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: 1,
                color: m.role === 'user' ? 'var(--foreground)' : 'var(--accent)',
              }}
            >
              {m.role === 'user' ? 'YOU' : 'TOBY'}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45, color: 'var(--foreground)' }}>{m.text}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message Toby…"
          style={{
            flex: 1,
            padding: 12,
            fontSize: 16,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'rgba(24,24,27,0.6)',
            color: 'var(--foreground)',
          }}
          disabled={busy}
        />
        <button
          onClick={() => void send()}
          disabled={!canSend}
          style={{
            padding: '12px 16px',
            fontSize: 16,
            fontWeight: 900,
            cursor: 'pointer',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: canSend ? 'var(--accent)' : 'rgba(161,161,170,0.2)',
            color: canSend ? '#04110a' : 'var(--muted)',
          }}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        v1: OpenAI-backed chat. No long-term memory yet.
      </div>
    </div>
  );
}
