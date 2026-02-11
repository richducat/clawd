'use client';

import { useEffect, useState } from 'react';
import Card from '../components/Card';

type Habit = { id: number; name: string; checkedToday: boolean };

export default function HabitsView() {
  const [day, setDay] = useState<string>('');
  const [habits, setHabits] = useState<Habit[] | null>(null);
  const [newHabit, setNewHabit] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await fetch('/api/lab/habits');
      const j = await r.json();
      if (j?.ok) {
        setDay(String(j.day || ''));
        setHabits((j.habits || []) as Habit[]);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async (habitId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/lab/habits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', habitId }),
      });
      const j = await r.json();
      if (j?.ok) {
        setHabits((prev) =>
          (prev || []).map((h) => (h.id === habitId ? { ...h, checkedToday: Boolean(j.checkedToday) } : h))
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const createHabit = async () => {
    const name = newHabit.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/lab/habits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name }),
      });
      const j = await r.json();
      if (j?.ok && j.habit) {
        setHabits((prev) => [ ...(prev || []), j.habit as Habit ]);
        setNewHabit('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-zinc-500 font-bold tracking-widest uppercase">Habits</div>
        <div className="text-lg font-black italic">Today {day ? `(${day})` : ''}</div>
        <div className="text-xs text-zinc-500">Real, DB-backed habit check-ins.</div>
      </div>

      <Card className="p-4 space-y-2">
        <div className="flex gap-2">
          <input
            value={newHabit}
            onChange={(e) => setNewHabit(e.target.value)}
            placeholder="Add a habit (e.g., Water, Steps, Stretch)"
            className="flex-1 bg-zinc-950 border border-white/10 rounded-xl px-3 py-2 text-sm"
          />
          <button
            onClick={createHabit}
            className="px-3 py-2 rounded-xl bg-violet-600 text-white text-sm font-black"
          >
            Add
          </button>
        </div>
      </Card>

      <div className="space-y-2">
        {habits === null ? (
          <Card className="p-4 text-sm text-zinc-400">Loading…</Card>
        ) : habits.length === 0 ? (
          <Card className="p-4 text-sm text-zinc-400">No habits yet. Add one above.</Card>
        ) : (
          habits.map((h) => (
            <Card
              key={h.id}
              className={`p-4 flex items-center justify-between cursor-pointer hover:bg-zinc-900 transition ${h.checkedToday ? 'border-emerald-500/30' : ''}`}
              onClick={() => toggle(h.id)}
            >
              <div>
                <div className="font-bold">{h.name}</div>
                <div className="text-xs text-zinc-500">Tap to toggle</div>
              </div>
              <div
                className={`text-xs font-black px-3 py-1 rounded-full ${
                  h.checkedToday ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {h.checkedToday ? 'Done' : 'Not yet'}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
