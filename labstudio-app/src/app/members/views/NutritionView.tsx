'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

type FoodSuggestion = {
  id: string;
  source: 'usda' | 'off';
  label: string;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  basis?: 'per_serving' | 'per_100g' | 'unknown';
};

export default function NutritionView() {
  const [data, setData] = useState<NutritionState | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({ name: '', p: 0, c: 0, f: 0, time: '', amount_g: 0 });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [suggestions, setSuggestions] = useState<FoodSuggestion[]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  // When a user selects a food from the database, we keep the base macros and allow
  // serving-size scaling (esp. OFF which is per 100g). If user edits macros manually,
  // auto-scaling is disabled.
  const [selected, setSelected] = useState<FoodSuggestion | null>(null);
  const [autoMacros, setAutoMacros] = useState(false);

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

  // Safety: abort any in-flight food search if this component unmounts.
  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recalcFromSelection = (nextAmountG: number) => {
    if (!selected || !autoMacros) return;
    if (selected.basis !== 'per_100g') return;
    const mult = (Number(nextAmountG) || 0) / 100;
    setForm((p) => ({
      ...p,
      p: Math.round(Number(selected.protein_g ?? 0) * mult),
      c: Math.round(Number(selected.carbs_g ?? 0) * mult),
      f: Math.round(Number(selected.fat_g ?? 0) * mult),
    }));
  };

  const save = async () => {
    setStatus('saving');
    try {
      const payload = {
        name:
          selected?.basis === 'per_100g' && (Number(form.amount_g) || 0) > 0
            ? `${form.name} (${Math.round(Number(form.amount_g))}g)`
            : form.name,
        p: form.p,
        c: form.c,
        f: form.f,
        time: form.time,
      };

      const res = await fetch('/api/lab/nutrition', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('failed');
      setStatus('saved');
      setForm({ name: '', p: 0, c: 0, f: 0, time: '', amount_g: 0 });
      setSelected(null);
      setAutoMacros(false);
      await load();
      setTimeout(() => setStatus('idle'), 1200);
    } catch {
      setStatus('error');
    }
  };

  const maxCals = useMemo(() => Math.max(...(data?.last7?.map((d) => d.calories) ?? [0])), [data?.last7]);

  const caloriesPreview = useMemo(() => (Number(form.p) || 0) * 4 + (Number(form.c) || 0) * 4 + (Number(form.f) || 0) * 9, [form.p, form.c, form.f]);

  const amountLabel = useMemo(() => {
    if (!selected) return null;
    if (selected.basis === 'per_100g') return 'grams';
    return null;
  }, [selected]);

  // Keep results stable: cancel in-flight searches and ignore stale responses.
  const [lastQuery, setLastQuery] = useState('');
  const searchAbortRef = useRef<AbortController | null>(null);

  const searchFoods = async (q: string) => {
    const query = q.trim();
    setLastQuery(query);

    if (query.length < 2) {
      searchAbortRef.current?.abort();
      setSuggestions([]);
      setSuggestBusy(false);
      return;
    }

    // Cancel previous search
    searchAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;

    setSuggestBusy(true);
    try {
      const r = await fetch(`/api/lab/foods/search?q=${encodeURIComponent(query)}&limit=8`, { signal: ac.signal });
      const j = await r.json();

      // Ignore stale responses
      if (ac.signal.aborted) return;
      if ((j?.q || '').trim() !== query) return;

      if (j?.ok && Array.isArray(j.foods)) setSuggestions(j.foods as FoodSuggestion[]);
      else setSuggestions([]);
    } catch (e) {
      // ignore abort errors and fetch errors
      if ((e as any)?.name !== 'AbortError') setSuggestions([]);
    } finally {
      if (!ac.signal.aborted) setSuggestBusy(false);
    }
  };

  useEffect(() => {
    if (!suggestOpen) return;

    const query = form.name.trim();
    // Clear suggestion list immediately when user changes input to avoid showing stale results.
    if (query !== lastQuery) setSuggestions([]);

    const t = setTimeout(() => {
      void searchFoods(form.name);
    }, 250);

    return () => {
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.name, suggestOpen]);

  const applySuggestion = (s: FoodSuggestion) => {
    setSelected(s);
    setAutoMacros(true);

    // OFF is per 100g → default to 100g and scale macros.
    const defaultAmount = s.basis === 'per_100g' ? 100 : 0;
    const mult = s.basis === 'per_100g' && defaultAmount > 0 ? defaultAmount / 100 : 1;

    setForm((p) => ({
      ...p,
      name: s.label,
      amount_g: defaultAmount,
      p: Math.round(Number(s.protein_g ?? 0) * mult),
      c: Math.round(Number(s.carbs_g ?? 0) * mult),
      f: Math.round(Number(s.fat_g ?? 0) * mult),
    }));
    setSuggestOpen(false);
  };

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

        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Food</div>
          <div className="relative">
            <input
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full"
              placeholder="Type to search (brand first)…"
              value={form.name}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => {
                // Close dropdown; also abort any in-flight searches.
                setTimeout(() => setSuggestOpen(false), 120);
                searchAbortRef.current?.abort();
                setSuggestBusy(false);
              }}
              onChange={(e) => {
                setSelected(null);
                setAutoMacros(false);
                setForm((p) => ({ ...p, name: e.target.value }));
              }}
            />

            {suggestOpen && suggestions.length ? (
              <div className="absolute z-20 mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applySuggestion(s)}
                    className="w-full text-left px-3 py-2 hover:bg-zinc-900"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-zinc-200 font-bold truncate">{s.label}</div>
                      <div className="text-[10px] font-mono text-zinc-500 shrink-0">
                        {s.source.toUpperCase()}{s.basis === 'per_100g' ? ' /100g' : ''}
                      </div>
                    </div>
                    <div className="text-[10px] font-mono text-zinc-500 mt-1">
                      P {Math.round(Number(s.protein_g ?? 0))}g · C {Math.round(Number(s.carbs_g ?? 0))}g · F {Math.round(Number(s.fat_g ?? 0))}g
                      {s.calories != null ? ` · ${Math.round(Number(s.calories))} kcal` : ''}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            {suggestOpen && suggestBusy ? <div className="text-[10px] text-zinc-500 mt-1">Searching…</div> : null}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Protein (g)</div>
            <input
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full"
              placeholder="e.g. 40"
              type="number"
              value={form.p}
              onChange={(e) => {
                setAutoMacros(false);
                setForm((p) => ({ ...p, p: Number(e.target.value) }));
              }}
            />
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Carbs (g)</div>
            <input
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full"
              placeholder="e.g. 20"
              type="number"
              value={form.c}
              onChange={(e) => {
                setAutoMacros(false);
                setForm((p) => ({ ...p, c: Number(e.target.value) }));
              }}
            />
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Fat (g)</div>
            <input
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full"
              placeholder="e.g. 10"
              type="number"
              value={form.f}
              onChange={(e) => {
                setAutoMacros(false);
                setForm((p) => ({ ...p, f: Number(e.target.value) }));
              }}
            />
          </div>
        </div>

        {amountLabel === 'grams' ? (
          <div className="grid grid-cols-2 gap-2 items-end">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Amount (g)</div>
              <input
                className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full"
                placeholder="100"
                type="number"
                value={form.amount_g}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setForm((p) => ({ ...p, amount_g: next }));
                  recalcFromSelection(next);
                }}
              />
            </div>
            <div className="text-[10px] text-zinc-500">
              {selected?.source === 'off' ? 'OpenFoodFacts is per 100g.' : 'Per 100g item.'}
              {autoMacros ? '' : ' (macros unlocked)'}
              {autoMacros ? (
                <button
                  type="button"
                  className="ml-2 underline text-zinc-400 hover:text-zinc-300"
                  onClick={() => {
                    setAutoMacros(true);
                    recalcFromSelection(form.amount_g);
                  }}
                >
                  Recalc
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            ≈ <span className="font-mono">{Math.round(caloriesPreview)}</span> kcal
            {status === 'saving' ? ' · Saving…' : status === 'saved' ? ' · Saved.' : status === 'error' ? ' · Failed.' : ''}
          </div>
          <button
            onClick={save}
            disabled={!form.name.trim() || status === 'saving'}
            className="text-xs font-bold text-white bg-emerald-500 px-3 py-1.5 rounded-full disabled:opacity-50"
          >
            Save
          </button>
        </div>

        <div className="text-[10px] text-zinc-600">
          Tips: Select a food to auto-fill macros. For OpenFoodFacts items, use Amount (g) to scale from per-100g nutrition.
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
