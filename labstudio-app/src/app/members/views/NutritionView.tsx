'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '../components/Card';

type NutritionState = {
  today: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    entries: Array<{ id: number; created_at: string; name: string; protein_g: number; carbs_g: number; fat_g: number; time_label: string | null }>;
  };
  last7: Array<{ day: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }>;
  avg7: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
};

export default function NutritionView() {
  const [data, setData] = useState<NutritionState | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({ name: '', p: 0, c: 0, f: 0, time: '' });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/lab/nutrition');
      const j = await r.json();
      if (j?.ok) setData(j as NutritionState);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await load();
      setTimeout(() => setStatus('idle'), 1200);
    } catch {
      setStatus('error');
    }
  };

  const maxCals = useMemo(() => Math.max(...(data?.last7?.map((d) => d.calories) ?? [0])), [data?.last7]);

  return (
    <div className="space-y-4 pb-20">
      <div className="px-1">
        <h1 className="text-2xl font-black italic uppercase">Nutrition</h1>
        <div className="text-xs text-zinc-500 mt-1">Today macros + 7-day averages (real DB-backed).</div>
      </div>

      <Card className="p-4">
        {loading ? (
          <div className="text-sm text-zinc-400">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Today</div>
              <div className="text-2xl font-black">{Math.round(data?.today?.calories ?? 0)} kcal</div>
              <div className="text-xs text-zinc-500 mt-1">
                P {Math.round(data?.today?.protein_g ?? 0)}g · C {Math.round(data?.today?.carbs_g ?? 0)}g · F {Math.round(data?.today?.fat_g ?? 0)}g
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">7-day avg</div>
              <div className="text-2xl font-black">{Math.round(data?.avg7?.calories ?? 0)} kcal</div>
              <div className="text-xs text-zinc-500 mt-1">
                P {Math.round(data?.avg7?.protein_g ?? 0)}g · C {Math.round(data?.avg7?.carbs_g ?? 0)}g · F {Math.round(data?.avg7?.fat_g ?? 0)}g
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Last 7 days</div>
        {data?.last7?.length ? (
          <div className="space-y-2">
            {data.last7.map((d) => (
              <div key={d.day} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="text-zinc-300 font-mono">{d.day}</div>
                  <div className="text-zinc-400 font-mono">{Math.round(d.calories)} kcal</div>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${maxCals ? Math.round((d.calories / maxCals) * 100) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-zinc-500">No logs yet this week.</div>
        )}
      </Card>

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

      <Card className="p-4 space-y-3">
        <div className="text-sm text-zinc-300">Today’s entries</div>
        {data?.today?.entries?.length ? (
          <div className="space-y-2">
            {data.today.entries.map((e) => (
              <div key={e.id} className="flex items-start justify-between text-xs">
                <div className="pr-2">
                  <div className="text-zinc-200 font-bold">{e.name}</div>
                  <div className="text-zinc-500 font-mono">
                    {e.time_label ? `${e.time_label} · ` : ''}{new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="text-right text-zinc-400 font-mono shrink-0">
                  P{e.protein_g} C{e.carbs_g} F{e.fat_g}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-zinc-500">No entries yet today.</div>
        )}
      </Card>
    </div>
  );
}
