'use client';

import { useState } from 'react';
import Card from '../components/Card';

export default function NutritionView() {
  const [form, setForm] = useState({ name: '', p: 0, c: 0, f: 0, time: '' });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = async () => {
    setStatus('saving');
    try {
      const res = await fetch('/api/lab/nutrition', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('failed');
      setStatus('saved');
      setForm({ name: '', p: 0, c: 0, f: 0, time: '' });
      setTimeout(() => setStatus('idle'), 1200);
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="px-1">
        <h1 className="text-2xl font-black italic uppercase">Nutrition</h1>
        <div className="text-xs text-zinc-500 mt-1">Real writes to Neon. No fake totals.</div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Log food</div>
        <input
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full"
          placeholder="Meal name"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
        />
        <div className="grid grid-cols-3 gap-2">
          <input
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm"
            placeholder="P"
            type="number"
            value={form.p}
            onChange={(e) => setForm((p) => ({ ...p, p: Number(e.target.value) }))}
          />
          <input
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm"
            placeholder="C"
            type="number"
            value={form.c}
            onChange={(e) => setForm((p) => ({ ...p, c: Number(e.target.value) }))}
          />
          <input
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm"
            placeholder="F"
            type="number"
            value={form.f}
            onChange={(e) => setForm((p) => ({ ...p, f: Number(e.target.value) }))}
          />
        </div>
        <input
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full"
          placeholder="Time label (optional)"
          value={form.time}
          onChange={(e) => setForm((p) => ({ ...p, time: e.target.value }))}
        />

        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved.' : status === 'error' ? 'Failed.' : ''}
          </div>
          <button
            onClick={save}
            disabled={!form.name.trim() || status === 'saving'}
            className="text-xs font-bold text-white bg-emerald-500 px-3 py-1.5 rounded-full disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm text-zinc-300">History</div>
        <div className="text-xs text-zinc-500 mt-2">Next: show today’s entries + macros from Neon.</div>
      </Card>
    </div>
  );
}
