'use client';

import Card from '../components/Card';
import { Dumbbell, Timer, Video, Zap } from 'lucide-react';

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

      <div className="rounded-2xl border border-white/5 bg-zinc-900/60 backdrop-blur-md p-4 text-xs text-zinc-500">
        Next: port WorkoutSessionView timers/interval blocks + PR tracking + XP rewards.
      </div>
    </div>
  );
}
