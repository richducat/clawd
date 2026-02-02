'use client';

import Card from '../components/Card';
import { Dumbbell, Timer, Video, Zap } from 'lucide-react';
import { useState } from 'react';

const PROGRAMS = [
  {
    id: 'regular',
    title: 'Regular Strength',
    desc: 'Track sets, rests, and personal bests.',
    icon: Dumbbell,
  },
  {
    id: 'circuit',
    title: 'Metcon Circuit',
    desc: 'Move station-to-station with guided timers.',
    icon: Zap,
  },
  {
    id: 'interval',
    title: 'Hands-Free Interval',
    desc: 'Voice cues + timers for focus.',
    icon: Timer,
  },
  {
    id: 'video',
    title: 'Coach Video',
    desc: 'Follow-along workout with form cues.',
    icon: Video,
  },
];

export default function WorkoutView({ onSelect }: { onSelect: (id: string) => void }) {
  const [workoutLog, setWorkoutLog] = useState({ kind: 'workout', durationMin: '', note: '' });
  const [pr, setPr] = useState({ lift: '', value: '', unit: 'lb', reps: '' });

  const saveWorkout = async () => {
    try {
      await fetch('/api/lab/workouts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(workoutLog),
      });
      setWorkoutLog({ kind: 'workout', durationMin: '', note: '' });
      alert('Workout saved');
    } catch {
      alert('Failed to save workout');
    }
  };

  const savePr = async () => {
    try {
      await fetch('/api/lab/strength-prs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pr),
      });
      setPr({ lift: '', value: '', unit: 'lb', reps: '' });
      alert('PR saved');
    } catch {
      alert('Failed to save PR');
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="px-1">
        <h1 className="text-2xl font-black italic uppercase">Workout</h1>
        <div className="text-xs text-zinc-500">Pick a mode. Full workout session UI is next.</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PROGRAMS.map((p) => {
          const Icon = p.icon;
          return (
            <Card key={p.id} className="p-4 hover:bg-zinc-800 transition" onClick={() => onSelect(p.id)}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-violet-400">
                  <Icon size={18} />
                </div>
                <div className="flex-1">
                  <div className="font-bold">{p.title}</div>
                  <div className="text-xs text-zinc-500 mt-1">{p.desc}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-4 space-y-3">
        <div className="font-bold">Log a completed workout (so Home session log is real)</div>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={workoutLog.kind}
            onChange={(e) => setWorkoutLog({ ...workoutLog, kind: e.target.value })}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm"
            placeholder="Kind (workout/cardio/etc)"
          />
          <input
            value={workoutLog.durationMin}
            onChange={(e) => setWorkoutLog({ ...workoutLog, durationMin: e.target.value })}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm"
            placeholder="Duration (min)"
          />
        </div>
        <textarea
          value={workoutLog.note}
          onChange={(e) => setWorkoutLog({ ...workoutLog, note: e.target.value })}
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm h-20 resize-none"
          placeholder="Notes (optional)"
        />
        <div className="flex justify-end">
          <button onClick={saveWorkout} className="text-xs font-bold text-white bg-emerald-500 px-3 py-1.5 rounded-full">
            Save Workout
          </button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="font-bold">Log a Strength PR</div>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={pr.lift}
            onChange={(e) => setPr({ ...pr, lift: e.target.value })}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm col-span-2"
            placeholder="Lift (e.g., Bench Press)"
          />
          <input
            value={pr.value}
            onChange={(e) => setPr({ ...pr, value: e.target.value })}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm"
            placeholder="Value"
          />
          <input
            value={pr.unit}
            onChange={(e) => setPr({ ...pr, unit: e.target.value })}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm"
            placeholder="Unit (lb/kg)"
          />
          <input
            value={pr.reps}
            onChange={(e) => setPr({ ...pr, reps: e.target.value })}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm col-span-2"
            placeholder="Reps (optional)"
          />
        </div>
        <div className="flex justify-end">
          <button onClick={savePr} className="text-xs font-bold text-white bg-violet-600 px-3 py-1.5 rounded-full">
            Save PR
          </button>
        </div>
      </Card>

      <div className="rounded-2xl border border-white/5 bg-zinc-900/60 backdrop-blur-md p-4 text-xs text-zinc-500">
        Next: port full WorkoutSessionView timers/interval blocks + XP rewards.
      </div>
    </div>
  );
}
