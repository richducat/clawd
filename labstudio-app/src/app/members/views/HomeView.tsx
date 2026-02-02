'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BookOpen,
  Calendar,
  Camera,
  CheckSquare,
  ChevronRight,
  Clock,
  Dumbbell,
  Gift,
  MessageSquare,
  Play,
  Smartphone,
  Trophy,
  User as UserIcon,
  Users,
  Utensils,
} from 'lucide-react';
import Card from '../components/Card';
import { DAILY_AGENDA, DEFAULT_NUTRITION_LOG, PROGRESS_TILES } from '../data/home';
import { logEvent, readStorage, writeStorage } from '@/lib/storage';

export default function HomeView({
  xp,
  level,
  credits,
  userProfile,
  setTab,
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
  setTab: (tab: string, meta?: Record<string, unknown>) => void;
}) {
  const nextLevel = (level + 1) * 1000;
  const progress = Math.min((xp / nextLevel) * 100, 100);

  const [nutritionLog] = useState(() => readStorage('lab-nutrition-log', DEFAULT_NUTRITION_LOG));
  const todaysCals = useMemo(
    () => nutritionLog.reduce((acc, curr) => acc + curr.p * 4 + curr.c * 4 + curr.f * 9, 0),
    [nutritionLog]
  );
  const todaysProtein = useMemo(
    () => nutritionLog.reduce((acc, curr) => acc + curr.p, 0),
    [nutritionLog]
  );

  const [showQuickLog, setShowQuickLog] = useState(false);
  const [statsLog, setStatsLog] = useState({ weight: String(userProfile.weight), bodyFat: '', note: '' });

  const defaultTilePrefs = useMemo(
    () => PROGRESS_TILES.map((tile, index) => ({ id: tile.id, visible: true, order: index })),
    []
  );
  const [tilePrefs, setTilePrefs] = useState(() => readStorage('lab-progress-tiles', defaultTilePrefs));
  const [showTileEditor, setShowTileEditor] = useState(false);

  const orderedTiles = useMemo(() => {
    const withMeta = tilePrefs
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((pref) => {
        const tile = PROGRESS_TILES.find((item) => item.id === pref.id);
        return tile ? { ...tile, visible: pref.visible } : null;
      })
      .filter(Boolean) as Array<(typeof PROGRESS_TILES)[number] & { visible: boolean }>;
    return withMeta;
  }, [tilePrefs]);

  useEffect(() => {
    writeStorage('lab-progress-tiles', tilePrefs);
  }, [tilePrefs]);

  const moveTile = (id: string, direction: number) => {
    setTilePrefs((prev) => {
      const current = [...prev].sort((a, b) => a.order - b.order);
      const index = current.findIndex((tile) => tile.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return prev;
      const next = current.map((tile) => ({ ...tile }));
      const tempOrder = next[index].order;
      next[index].order = next[nextIndex].order;
      next[nextIndex].order = tempOrder;
      return next;
    });
  };

  const toggleTile = (id: string) => {
    setTilePrefs((prev) => prev.map((tile) => (tile.id === id ? { ...tile, visible: !tile.visible } : tile)));
  };

  const logDailyStats = async () => {
    logEvent('daily_stats_logged', statsLog);
    try {
      await fetch('/api/lab/daily-stats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weight: statsLog.weight, bodyFat: statsLog.bodyFat, note: statsLog.note }),
      });
    } catch {
      // ignore (offline etc.)
    }
    setShowQuickLog(false);
  };

  const bfText = useMemo(() => {
    const bf = userProfile.bf;
    if (typeof bf === 'number' && Number.isFinite(bf)) return `${bf}% BF`;
    if (typeof bf === 'string' && bf.trim()) return bf;
    return `We’ll compute this later`;
  }, [userProfile.bf]);

  return (
    <div className="pb-20 lg:pb-10">
      <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6">
        {/* LEFT COLUMN */}
        <div className="space-y-4">
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
          </div>

          <Card
            className="bg-gradient-to-r from-violet-900/20 to-zinc-900 border-l-4 border-l-violet-500 p-4"
            onClick={() => setTab('book', { source: 'home_card' })}
          >
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
              <div
                className="h-full bg-gradient-to-r from-violet-600 to-fuchsia-500 transition-all duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
            {credits > 0 ? (
              <div className="mt-3 flex items-center gap-2 text-xs font-bold text-yellow-500 bg-yellow-500/10 p-2 rounded-lg border border-yellow-500/20">
                <Gift size={14} />
                {credits} FREE FOOD ITEM{credits > 1 ? 'S' : ''} AVAILABLE
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-4">
          <Card className="bg-zinc-900/80 p-0 overflow-hidden border-zinc-800">
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
                  <div className="font-mono font-bold">{Math.round(todaysCals)}</div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-zinc-400">Protein</div>
                  <div className="font-mono font-bold text-emerald-400">{Math.round(todaysProtein)}g</div>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Session Log</div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-zinc-400">Booked</div>
                  <div className="font-mono font-bold">5</div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-zinc-400">Made</div>
                  <div className="font-mono font-bold text-blue-400">3</div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-zinc-400">Missed</div>
                  <div className="font-mono font-bold text-zinc-600">0</div>
                </div>
              </div>
            </div>
          </Card>

          {/* Things to do today */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div>
                <h2 className="font-bold text-lg">Things to do today</h2>
                <div className="text-xs text-zinc-500">Your daily agenda with jump-ins.</div>
              </div>
              <button
                onClick={() => setShowQuickLog((prev) => !prev)}
                className="text-xs font-bold text-violet-400 hover:text-violet-200"
              >
                {showQuickLog ? 'Close' : 'Quick Log'}
              </button>
            </div>

            <div className="space-y-2">
              {DAILY_AGENDA.map((item) => (
                <Card key={item.id} className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-violet-400">
                      {item.type === 'Workout' ? <Dumbbell size={18} /> : null}
                      {item.type === 'Cardio' ? <Activity size={18} /> : null}
                      {item.type === 'Habit' ? <CheckSquare size={18} /> : null}
                      {item.type === 'Check-in' ? <Camera size={18} /> : null}
                    </div>
                    <div>
                      <div className="font-bold text-sm">{item.title}</div>
                      <div className="text-xs text-zinc-500">
                        {item.time} • {item.type}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => (item.action === 'progress' ? setShowQuickLog(true) : setTab(item.action))}
                    className="text-xs font-bold text-white bg-violet-600 px-3 py-1.5 rounded-full hover:bg-violet-500"
                  >
                    Jump in
                  </button>
                </Card>
              ))}
            </div>

            {showQuickLog ? (
              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 uppercase tracking-widest">
                  <Camera size={14} /> Daily Check-in
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={statsLog.weight}
                    onChange={(event) => setStatsLog({ ...statsLog, weight: event.target.value })}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm"
                    placeholder="Weight (lbs)"
                  />
                  <input
                    value={statsLog.bodyFat}
                    onChange={(event) => setStatsLog({ ...statsLog, bodyFat: event.target.value })}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm"
                    placeholder="Body fat %"
                  />
                </div>
                <textarea
                  value={statsLog.note}
                  onChange={(event) => setStatsLog({ ...statsLog, note: event.target.value })}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm h-20 resize-none"
                  placeholder="Progress photo notes, mood, soreness..."
                />
                <div className="flex justify-between items-center text-xs text-zinc-500">
                  <span>Upload progress photos in the Photos tile.</span>
                  <button
                    onClick={logDailyStats}
                    className="text-xs font-bold text-white bg-emerald-500 px-3 py-1.5 rounded-full"
                  >
                    Save
                  </button>
                </div>
              </Card>
            ) : null}
          </div>

          {/* My Progress */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div>
                <h2 className="font-bold text-lg">My Progress</h2>
                <div className="text-xs text-zinc-500">Customize the tiles that matter to you.</div>
              </div>
              <button
                onClick={() => setShowTileEditor((prev) => !prev)}
                className="text-xs font-bold text-violet-400 hover:text-violet-200"
              >
                {showTileEditor ? 'Done' : 'Edit Tiles'}
              </button>
            </div>

            {showTileEditor ? (
              <Card className="p-3 space-y-2">
                {orderedTiles.map((tile) => (
                  <div key={tile.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <button onClick={() => moveTile(tile.id, -1)} className="p-1 bg-zinc-800 rounded">
                        <ChevronRight size={12} className="rotate-180" />
                      </button>
                      <button onClick={() => moveTile(tile.id, 1)} className="p-1 bg-zinc-800 rounded">
                        <ChevronRight size={12} />
                      </button>
                      <span className="font-bold">{tile.label}</span>
                    </div>
                    <button
                      onClick={() => toggleTile(tile.id)}
                      className={`px-2 py-1 rounded-full font-bold ${
                        tile.visible ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {tile.visible ? 'Visible' : 'Hidden'}
                    </button>
                  </div>
                ))}
              </Card>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              {orderedTiles
                .filter((tile) => tile.visible)
                .map((tile) => {
                  const Icon = (tile as any).icon;
                  return (
                    <Card key={tile.id} className="p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span className="uppercase font-bold tracking-widest">{tile.label}</span>
                        <Icon size={14} className="text-violet-400" />
                      </div>
                      <div className="text-lg font-black">{tile.value}</div>
                      <div className="text-[10px] text-emerald-400">{tile.trend}</div>
                    </Card>
                  );
                })}
            </div>
          </div>

          {/* Quick Actions */}
          <div>
            <div className="flex justify-between items-end mb-3 px-1">
              <h2 className="font-bold text-lg">Quick Actions</h2>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <Card className="p-0 group" onClick={() => setTab('workout')}>
                <div className="p-4 flex justify-between items-center relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center">
                      <Dumbbell size={20} className="text-violet-400" />
                    </div>
                    <div>
                      <div className="font-bold text-lg">Start Workout</div>
                      <div className="text-xs text-zinc-500">Regular, circuit, interval, or video</div>
                    </div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-violet-600 group-hover:text-white transition-colors">
                    <Play size={14} fill="currentColor" />
                  </div>
                </div>
                <div className="h-1 bg-zinc-800 w-full">
                  <div className="h-full bg-violet-600 w-1/3" />
                </div>
              </Card>

              <div className="grid grid-cols-2 gap-3">
                <Card
                  className="p-4 flex flex-col justify-center items-center gap-2 hover:bg-zinc-800 group transition"
                  onClick={() => setTab('nutrition')}
                >
                  <Utensils size={24} className="text-emerald-400 group-hover:scale-110 transition" />
                  <div className="text-xs font-bold">NUTRITION</div>
                </Card>
                <Card
                  className="p-4 flex flex-col justify-center items-center gap-2 hover:bg-zinc-800 group transition"
                  onClick={() => setTab('habits')}
                >
                  <CheckSquare size={24} className="text-yellow-400 group-hover:scale-110 transition" />
                  <div className="text-xs font-bold">HABITS</div>
                </Card>
                <Card
                  className="p-4 flex flex-col justify-center items-center gap-2 hover:bg-zinc-800 group transition"
                  onClick={() => setTab('messages')}
                >
                  <MessageSquare size={24} className="text-violet-400 group-hover:scale-110 transition" />
                  <div className="text-xs font-bold">MESSAGES</div>
                </Card>
                <Card
                  className="p-4 flex flex-col justify-center items-center gap-2 hover:bg-zinc-800 group transition"
                  onClick={() => setTab('community')}
                >
                  <Users size={24} className="text-blue-400 group-hover:scale-110 transition" />
                  <div className="text-xs font-bold">COMMUNITY</div>
                </Card>
                <Card
                  className="p-4 flex flex-col justify-center items-center gap-2 hover:bg-zinc-800 group transition"
                  onClick={() => setTab('challenges')}
                >
                  <Trophy size={24} className="text-orange-400 group-hover:scale-110 transition" />
                  <div className="text-xs font-bold">CHALLENGES</div>
                </Card>
                <Card
                  className="p-4 flex flex-col justify-center items-center gap-2 hover:bg-zinc-800 group transition"
                  onClick={() => setTab('wearables')}
                >
                  <Smartphone size={24} className="text-cyan-400 group-hover:scale-110 transition" />
                  <div className="text-xs font-bold">WEARABLES</div>
                </Card>
                <Card
                  className="p-4 flex flex-col justify-center items-center gap-2 hover:bg-zinc-800 group transition"
                  onClick={() => setTab('social')}
                >
                  <Users size={24} className="text-pink-400 group-hover:scale-110 transition" />
                  <div className="text-xs font-bold">SQUAD</div>
                </Card>
                <Card
                  className="p-4 flex flex-col justify-center items-center gap-2 hover:bg-zinc-800 group transition"
                  onClick={() => setTab('library')}
                >
                  <BookOpen size={24} className="text-emerald-400 group-hover:scale-110 transition" />
                  <div className="text-xs font-bold">THE VAULT</div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
