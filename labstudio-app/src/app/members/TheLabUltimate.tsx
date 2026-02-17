'use client';

import { useEffect, useState } from 'react';
import { Activity, Calendar, MessageSquare, Brain, ShoppingBag, User } from 'lucide-react';

import TobyCoachView from './TobyCoachView';
import HomeView from './views/HomeView';
import WorkoutView from './views/WorkoutView';
import BookView from './views/BookView';
import NutritionView from './views/NutritionView';
import HabitsView from './views/HabitsView';
import MessagesView from './views/MessagesView';
import CommunityView from './views/CommunityView';
import ChallengesView from './views/ChallengesView';
import WearablesView from './views/WearablesView';
import SocialView from './views/SocialView';
import LibraryView from './views/LibraryView';
import GamesView from './views/GamesView';
import MarketView from './views/MarketView';
import ProgressView from './views/ProgressView';
import ProfileView from './views/ProfileView';

type Tab =
  | 'home'
  | 'book'
  | 'coach'
  | 'games'
  | 'market'
  | 'profile'
  | 'workout'
  | 'nutrition'
  | 'habits'
  | 'messages'
  | 'community'
  | 'challenges'
  | 'wearables'
  | 'social'
  | 'library'
  | 'progress';

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

export default function TheLabUltimate({
  initialUser,
  initialProfile,
  needsOnboarding,
}: {
  initialUser: { display_name?: string; xp?: number; level?: number } | null;
  initialProfile: {
    first_name?: string | null;
    last_name?: string | null;
    goal?: string | null;
  } | null;
  needsOnboarding?: boolean;
}) {
  const [tab, setTabState] = useState<Tab>('home');
  const [tabMeta, setTabMeta] = useState<Record<string, unknown> | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<null | { kind: 'success' | 'cancel' }>(() => {
    // Read once on mount (client-only) so we don't call setState inside an effect.
    try {
      if (typeof window === 'undefined') return null;
      const sp = new URLSearchParams(window.location.search);
      const checkout = sp.get('checkout');
      return checkout === 'success' || checkout === 'cancel' ? { kind: checkout } : null;
    } catch {
      return null;
    }
  });
  const xp = initialUser?.xp ?? 0;
  const level = initialUser?.level ?? 1;
  const name =
    [initialProfile?.first_name, initialProfile?.last_name].filter(Boolean).join(' ') ||
    initialUser?.display_name ||
    'Athlete';
  const goal = initialProfile?.goal ?? null;

  const setTab = (next: string, meta?: Record<string, unknown>) => {
    setTabState(next as Tab);
    setTabMeta(meta ?? null);
  };

  useEffect(() => {
    // If we showed a checkout notice, remove the query param (pure side-effect).
    try {
      if (!checkoutNotice) return;
      const sp = new URLSearchParams(window.location.search);
      const checkout = sp.get('checkout');
      if (checkout === 'success' || checkout === 'cancel') {
        sp.delete('checkout');
        const next = `${window.location.pathname}${sp.toString() ? `?${sp.toString()}` : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, '', next);
      }
    } catch {
      // ignore
    }
  }, [checkoutNotice]);

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
      <main className="max-w-md lg:max-w-6xl mx-auto p-4 relative z-10">
        {checkoutNotice ? (
          <div
            className={`mb-4 rounded-2xl border p-4 flex items-start justify-between gap-4 ${
              checkoutNotice.kind === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10'
                : 'border-zinc-500/30 bg-white/5'
            }`}
          >
            <div>
              <div className="text-xs font-bold tracking-widest uppercase text-zinc-400">
                {checkoutNotice.kind === 'success' ? 'Payment complete' : 'Checkout canceled'}
              </div>
              <div className="text-sm text-zinc-200 mt-1">
                {checkoutNotice.kind === 'success'
                  ? 'You’re all set. Stripe will email a receipt, and any membership entitlements will activate automatically.'
                  : 'No worries — your cart is still here.'}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs font-black text-zinc-200 bg-white/10 hover:bg-white/15 px-3 py-2 rounded-xl"
              onClick={() => setCheckoutNotice(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}
        {needsOnboarding ? (
          <div className="mb-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-yellow-400 tracking-widest uppercase">Action needed</div>
              <div className="text-sm text-zinc-200">Finish onboarding so your dashboard, coaching, and plans are personalized.</div>
            </div>
            <a
              href="/onboarding"
              className="shrink-0 text-xs font-black text-zinc-950 bg-yellow-400 hover:bg-yellow-300 px-3 py-2 rounded-xl"
            >
              Finish onboarding
            </a>
          </div>
        ) : null}
        {tab === 'home' && (
          <HomeView
            xp={xp}
            level={level}
            credits={0}
            userProfile={{ name, goal }}
            setTab={setTab}
          />
        )}

        {tab === 'coach' && <TobyCoachView />}

        {tab === 'book' && <BookView />}
        {tab === 'games' && <GamesView />}
        {tab === 'market' && <MarketView />}
        {tab === 'profile' && <ProfileView />}

        {tab === 'workout' && <WorkoutView onSelect={() => {}} />}
        {tab === 'nutrition' && <NutritionView />}
        {tab === 'habits' && <HabitsView />}
        {tab === 'messages' && <MessagesView />}
        {tab === 'community' && <CommunityView />}
        {tab === 'challenges' && <ChallengesView />}
        {tab === 'wearables' && <WearablesView />}
        {tab === 'social' && <SocialView />}
        {tab === 'library' && <LibraryView />}
        {tab === 'progress' && (
          <ProgressView
            mode={(tabMeta?.mode as any) === 'prs' ? 'prs' : 'photos'}
            onBack={() => setTab('home')}
          />
        )}
      </main>

      {/* Nav Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-zinc-950/90 backdrop-blur-xl border-t border-white/10 z-50 pb-safe pt-2 shadow-[0_-10px_40px_-10px_rgba(0,0,0,1)]">
        <div className="max-w-md lg:max-w-6xl mx-auto flex justify-around items-center px-1">
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
          <NavBtn icon={User} label="Me" active={tab === 'profile'} onClick={() => setTab('profile')} />
        </div>
      </nav>
    </div>
  );
}
