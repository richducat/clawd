'use client';

import { useState } from 'react';
import {
  Activity,
  Calendar,
  MessageSquare,
  Brain,
  ShoppingBag,
} from 'lucide-react';

import TobyCoachView from './TobyCoachView';
import HomeView from './views/HomeView';

type Tab = 'home' | 'book' | 'coach' | 'games' | 'market';

function NavBtn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-2 w-14 rounded-xl transition-all ${
        active ? 'text-white scale-105' : 'text-zinc-600 hover:text-zinc-400'
      }`}
    >
      <Icon size={22} strokeWidth={active ? 2.5 : 2} />
      <span className="text-[9px] font-bold tracking-wide uppercase">{label}</span>
    </button>
  );
}

export default function TheLabUltimate({ initialUser }: { initialUser: { display_name?: string; xp?: number; level?: number } | null }) {
  const [tab, setTab] = useState<Tab>('home');
  const xp = initialUser?.xp ?? 1250;
  const level = initialUser?.level ?? 3;
  const name = initialUser?.display_name ?? 'YOU';

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans selection:bg-violet-500/30 pb-24 relative overflow-hidden">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-violet-900/20 blur-[150px] rounded-full animate-pulse"
          style={{ animationDuration: '4s' }}
        />
        <div
          className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-emerald-900/10 blur-[150px] rounded-full animate-pulse"
          style={{ animationDuration: '7s' }}
        />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-zinc-950/80 backdrop-blur-xl border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setTab('home')}>
          <div className="w-9 h-9 bg-violet-600 rounded-xl flex items-center justify-center font-black italic shadow-[0_0_15px_rgba(124,58,237,0.4)]">
            L
          </div>
          <div>
            <div className="font-bold tracking-wider leading-none">THE LAB</div>
            <div className="text-[9px] text-zinc-500 tracking-[0.2em] font-bold">ULTIMATE</div>
          </div>
        </div>

        <div className="text-xs text-zinc-400 font-mono">app.labstudio.fit</div>
      </header>

      {/* Content */}
      <main className="max-w-md mx-auto p-4 relative z-10">
        {tab === 'home' && (
          <HomeView
            xp={xp}
            level={level}
            credits={1}
            userProfile={{ name, goal: 'Hypertrophy', weight: 185, bf: 14 }}
            onGoBook={() => setTab('book')}
          />
        )}

        {tab === 'coach' && <TobyCoachView />}

        {tab !== 'home' && tab !== 'coach' && (
          <div className="rounded-2xl border border-white/5 bg-zinc-900/60 backdrop-blur-md p-4">
            <div className="font-bold uppercase tracking-wider text-xs text-zinc-400">{tab}</div>
            <div className="text-sm text-zinc-300 mt-2">Placeholder (port in next).</div>
          </div>
        )}
      </main>

      {/* Nav Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-zinc-950/90 backdrop-blur-xl border-t border-white/10 z-50 pb-safe pt-2 shadow-[0_-10px_40px_-10px_rgba(0,0,0,1)]">
        <div className="max-w-md mx-auto flex justify-around items-center px-1">
          <NavBtn icon={Activity} label="Dash" active={tab === 'home'} onClick={() => setTab('home')} />
          <NavBtn icon={Calendar} label="Book" active={tab === 'book'} onClick={() => setTab('book')} />

          <div className="-mt-10 relative group">
            <div className="absolute inset-0 bg-violet-600 blur-xl opacity-40 rounded-full group-hover:opacity-60 transition duration-500" />
            <button
              onClick={() => setTab('coach')}
              className={`h-16 w-16 rounded-full flex items-center justify-center border-4 border-zinc-950 relative z-10 transition-all duration-300 ${
                tab === 'coach'
                  ? 'bg-white text-violet-600 scale-110 shadow-xl'
                  : 'bg-violet-600 text-white group-hover:bg-violet-500 group-hover:scale-105'
              }`}
            >
              <MessageSquare size={26} fill="currentColor" />
            </button>
          </div>

          <NavBtn icon={Brain} label="Games" active={tab === 'games'} onClick={() => setTab('games')} />
          <NavBtn icon={ShoppingBag} label="Shop" active={tab === 'market'} onClick={() => setTab('market')} />
        </div>
      </nav>
    </div>
  );
}
