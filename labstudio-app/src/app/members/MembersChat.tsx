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
      const res = await fetch('/api/toby/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
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
          border: '1px solid #ddd',
          borderRadius: 10,
          padding: 14,
          minHeight: 360,
          maxHeight: 520,
          overflow: 'auto',
          background: '#fff',
        }}
      >
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: m.role === 'user' ? '#111' : '#0b5' }}>
              {m.role === 'user' ? 'YOU' : 'TOBY'}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{m.text}</div>
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
          style={{ flex: 1, padding: 12, fontSize: 16 }}
          disabled={busy}
        />
        <button
          onClick={() => void send()}
          disabled={!canSend}
          style={{ padding: '12px 16px', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: '#666' }}>
        v1: OpenAI-backed chat. No long-term memory yet.
      </div>
    </div>
  );
}
