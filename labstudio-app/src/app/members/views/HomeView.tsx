'use client';

import { useMemo } from 'react';
import {
  Activity,
  AlertCircle,
  Calendar,
  Clock,
  Gift,
  Trophy,
  User as UserIcon,
} from 'lucide-react';
import Card from '../components/Card';

export default function HomeView({
  xp,
  level,
  credits,
  userProfile,
  onGoBook,
}: {
  xp: number;
  level: number;
  credits: number;
  userProfile: {
    name: string;
    goal: string;
    weight: number;
    bf?: number | string;
  };
  onGoBook: () => void;
}) {
  const nextLevel = (level + 1) * 1000;
  const progress = Math.min((xp / nextLevel) * 100, 100);

  const bfText = useMemo(() => {
    const bf = userProfile.bf;
    if (typeof bf === 'number' && Number.isFinite(bf)) return `${bf}% BF`;
    if (typeof bf === 'string' && bf.trim()) return bf;
    return `We’ll compute this later`;
  }, [userProfile.bf]);

  return (
    <div className="space-y-6 pb-20">
      <div className="relative pt-2">
        <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-[0.85] mb-2">
          UNLEASH
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-500 via-fuchsia-400 to-white">
            POTENTIAL
          </span>
        </h1>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live: 12% Capacity
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">OPEN UNTIL 10PM</div>
        </div>

        <Card className="mb-4 bg-zinc-900/80 p-0 overflow-hidden border-zinc-800">
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-zinc-900">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-zinc-400">
                <UserIcon size={20} />
              </div>
              <div>
                <div className="font-black italic text-lg leading-none uppercase">{userProfile.name}</div>
                <div className="text-[10px] font-mono text-zinc-500">GOAL: {userProfile.goal.toUpperCase()}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold text-violet-400">{userProfile.weight} lbs</div>
              <div className="text-[10px] text-zinc-500">{bfText}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-white/5">
            <div className="p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Nutrition Today</div>
              <div className="flex justify-between items-center">
                <div className="text-xs text-zinc-400">Cals</div>
                <div className="font-mono font-bold">—</div>
              </div>
              <div className="flex justify-between items-center">
                <div className="text-xs text-zinc-400">Protein</div>
                <div className="font-mono font-bold text-emerald-400">—</div>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Session Log</div>
              <div className="flex justify-between items-center">
                <div className="text-xs text-zinc-400">Booked</div>
                <div className="font-mono font-bold">—</div>
              </div>
              <div className="flex justify-between items-center">
                <div className="text-xs text-zinc-400">Made</div>
                <div className="font-mono font-bold text-blue-400">—</div>
              </div>
              <div className="flex justify-between items-center">
                <div className="text-xs text-zinc-400">Missed</div>
                <div className="font-mono font-bold text-zinc-600">—</div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="mb-4 bg-gradient-to-r from-violet-900/20 to-zinc-900 border-l-4 border-l-violet-500 p-4" onClick={onGoBook}>
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2 text-violet-400 font-bold text-xs uppercase tracking-widest">
              <Calendar size={12} /> Next Mission
            </div>
            <div className="bg-zinc-900 border border-white/10 px-2 py-1 rounded text-[10px] font-mono text-zinc-400">TOMORROW</div>
          </div>
          <div className="font-black text-xl italic mb-1">1:1 PROTOCOL</div>
          <div className="flex items-center gap-2 text-sm text-zinc-300 mb-3">
            <Clock size={14} className="text-zinc-500" /> 06:00 PM
          </div>

          <div className="bg-black/20 rounded-lg p-3 border border-white/5 flex gap-3 items-start">
            <AlertCircle size={16} className="text-yellow-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold text-zinc-300">INTEL:</div>
              <div className="text-xs text-zinc-500">Heavy Upper Body Focus. Bring lifting straps. Expect failure sets on Chest Press.</div>
            </div>
          </div>
        </Card>

        <div className="bg-zinc-900 border border-white/10 p-4 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition">
            <Trophy size={60} />
          </div>
          <div className="flex justify-between items-end mb-2 relative z-10">
            <div>
              <div className="text-xs text-zinc-500 font-bold tracking-widest uppercase">Current Rank</div>
              <div className="text-2xl font-black italic">LEVEL {level}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-violet-400 font-bold tracking-widest uppercase">{nextLevel - xp} XP TO REWARD</div>
            </div>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden relative z-10">
            <div className="h-full bg-gradient-to-r from-violet-600 to-fuchsia-500 transition-all duration-1000" style={{ width: `${progress}%` }} />
          </div>
          {credits > 0 ? (
            <div className="mt-3 flex items-center gap-2 text-xs font-bold text-yellow-500 bg-yellow-500/10 p-2 rounded-lg border border-yellow-500/20">
              <Gift size={14} />
              {credits} FREE FOOD ITEM{credits > 1 ? 'S' : ''} AVAILABLE
            </div>
          ) : null}
        </div>

        <div className="mt-6 rounded-2xl border border-white/5 bg-zinc-900/60 backdrop-blur-md p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-violet-400">
              <Activity size={18} />
            </div>
            <div>
              <div className="font-bold text-sm">Next: Full Home port</div>
              <div className="text-xs text-zinc-500">Nutrition log, agenda, progress tiles editor, and real data wiring.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
