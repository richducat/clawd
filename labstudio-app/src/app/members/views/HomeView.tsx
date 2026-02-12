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
import { PROGRESS_TILES } from '../data/home';
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
    goal: string | null;
  };
  setTab: (tab: string, meta?: Record<string, unknown>) => void;
}) {
  const nextLevel = (level + 1) * 1000;
  const progress = Math.min((xp / nextLevel) * 100, 100);

  const [homeData, setHomeData] = useState<{
    profile: { first_name?: string | null; last_name?: string | null; goal?: string | null } | null;
    nutrition: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
    latestStats: { weight_lbs: string | number | null; body_fat_pct: string | number | null; resting_hr: number | null } | null;
    nextBooking: { summary: string; start: string; end: string; location: string | null; description: string | null } | null;
    upcomingBookings?: Array<{ summary: string; start: string; end: string; location: string | null; description: string | null }>;
    recentWorkouts?: Array<{ id: number; created_at: string; kind: string | null; duration_min: number | null; note: string | null }>;
    sessionLog?: { bookedUpcoming30d: number; completed7d: number; missedApprox30d: number };
    progress?: {
      photos30d: number;
      calories7dAvg: number;
      workouts7d?: { count: number; minutes: number };
      latestPr: { lift: string; value: number; unit: string; reps: number | null } | null;
    };
    agenda?: Array<{ id: string; title: string; time: string | null; type: string; action: string; completed: boolean }>;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/lab/home')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data?.ok) setHomeData(data.home);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      mounted = false;
    };
  }, []);

  const homeLoaded = homeData !== null;

  // Avoid “default looks-real” values before /api/lab/home returns.
  const todaysCals = homeLoaded ? (homeData?.nutrition?.calories ?? 0) : null;
  const todaysProtein = homeLoaded ? (homeData?.nutrition?.protein_g ?? 0) : null;

  const [showQuickLog, setShowQuickLog] = useState(false);
  const [statsLog, setStatsLog] = useState({ weight: '', bodyFat: '', restingHr: '', note: '' });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoNote, setPhotoNote] = useState('');

  useEffect(() => {
    // When DB data arrives, prefill the quick log with the latest recorded values.
    if (!homeData?.latestStats) return;
    setStatsLog((prev) => ({
      ...prev,
      weight: homeData.latestStats?.weight_lbs != null ? String(homeData.latestStats.weight_lbs) : prev.weight,
      bodyFat: homeData.latestStats?.body_fat_pct != null ? String(homeData.latestStats.body_fat_pct) : prev.bodyFat,
      restingHr: homeData.latestStats?.resting_hr != null ? String(homeData.latestStats.resting_hr) : prev.restingHr,
    }));
  }, [homeData?.latestStats]);

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
        body: JSON.stringify({
          weight: statsLog.weight,
          bodyFat: statsLog.bodyFat,
          restingHr: statsLog.restingHr,
          note: statsLog.note,
        }),
      });
    } catch {
      // ignore (offline etc.)
    }
  };

  const saveProgressPhoto = async () => {
    if (!photoFile) return;
    const toDataUrl = (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read failed'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });

    try {
      const imageDataUrl = await toDataUrl(photoFile);
      await fetch('/api/lab/progress-photos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageDataUrl, note: photoNote }),
      });
    } catch {
      // ignore
    }
  };

  const saveCheckin = async () => {
    await Promise.all([logDailyStats(), saveProgressPhoto()]);
    setPhotoFile(null);
    setPhotoNote('');
    setShowQuickLog(false);
    // refresh home data
    try {
      const r = await fetch('/api/lab/home');
      const data = await r.json();
      if (data?.ok) setHomeData(data.home);
    } catch {
      // ignore
    }
  };

  const bfText = useMemo(() => {
    const bf = homeData?.latestStats?.body_fat_pct;
    const n = bf == null ? NaN : Number(bf);
    if (Number.isFinite(n)) return `${n}% BF`;
    return '—';
  }, [homeData?.latestStats?.body_fat_pct]);

  const [coach, setCoach] = useState<{
    pinned: { id: number; text: string; pinned: boolean } | null;
    history: Array<{ id: number; text: string; pinned: boolean }>;
  } | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);

  const loadCoach = async () => {
    try {
      const r = await fetch('/api/lab/coach-focus');
      const j = await r.json();
      if (j?.ok) setCoach({ pinned: j.pinned ?? null, history: j.history ?? [] });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadCoach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateCoach = async () => {
    setCoachBusy(true);
    try {
      const r = await fetch('/api/lab/coach-focus', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      });
      const j = await r.json();
      if (j?.ok) setCoach({ pinned: j.pinned ?? null, history: j.history ?? [] });
    } finally {
      setCoachBusy(false);
    }
  };

  const pinCoach = async (id: number) => {
    setCoachBusy(true);
    try {
      const r = await fetch('/api/lab/coach-focus', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pin', id }),
      });
      const j = await r.json();
      if (j?.ok) setCoach({ pinned: j.pinned ?? null, history: j.history ?? [] });
    } finally {
      setCoachBusy(false);
    }
  };

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
          </div>

          {homeData?.nextBooking ? (
            <Card
              className="bg-gradient-to-r from-violet-900/20 to-zinc-900 border-l-4 border-l-violet-500 p-4"
              onClick={() => setTab('book', { source: 'home_card' })}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2 text-violet-400 font-bold text-xs uppercase tracking-widest">
                  <Calendar size={12} /> Next Mission
                </div>
                <div className="bg-zinc-900 border border-white/10 px-2 py-1 rounded text-[10px] font-mono text-zinc-400">
                  {new Date(homeData.nextBooking.start).toLocaleDateString()}
                </div>
              </div>
              <div className="font-black text-xl italic mb-1">{homeData.nextBooking.summary || 'Session'}</div>
              <div className="flex items-center gap-2 text-sm text-zinc-300 mb-3">
                <Clock size={14} className="text-zinc-500" />{' '}
                {new Date(homeData.nextBooking.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>

              {homeData.nextBooking.description ? (
                <div className="bg-black/20 rounded-lg p-3 border border-white/5 flex gap-3 items-start">
                  <AlertCircle size={16} className="text-yellow-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-zinc-300">NOTES:</div>
                    <div className="text-xs text-zinc-500">{homeData.nextBooking.description}</div>
                  </div>
                </div>
              ) : null}

              {homeData.upcomingBookings && homeData.upcomingBookings.length > 1 ? (
                <div className="mt-3 border-t border-white/5 pt-3">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Upcoming (next 30d)</div>
                  <div className="space-y-2">
                    {homeData.upcomingBookings.slice(1).map((b, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs text-zinc-300">
                        <div className="truncate pr-2">{b.summary || 'Session'}</div>
                        <div className="text-zinc-500 font-mono shrink-0">
                          {new Date(b.start).toLocaleDateString()} {new Date(b.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>
          ) : (
            <Card className="bg-zinc-900/60 backdrop-blur-md p-4" onClick={() => setTab('book')}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Next Mission</div>
                  <div className="text-sm text-zinc-300 mt-1">No session scheduled yet.</div>
                </div>
                <div className="text-xs font-bold text-white bg-violet-600 px-3 py-1.5 rounded-full">Book</div>
              </div>

              {homeData?.upcomingBookings && homeData.upcomingBookings.length ? (
                <div className="mt-3 border-t border-white/5 pt-3">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Upcoming (next 30d)</div>
                  <div className="space-y-2">
                    {homeData.upcomingBookings.map((b, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs text-zinc-300">
                        <div className="truncate pr-2">{b.summary || 'Session'}</div>
                        <div className="text-zinc-500 font-mono shrink-0">
                          {new Date(b.start).toLocaleDateString()} {new Date(b.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>
          )}

          <Card className="bg-zinc-900/80 p-4 border-zinc-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Coach plan</div>
                <div className="text-lg font-black italic">Today’s Focus</div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void generateCoach();
                }}
                disabled={coachBusy}
                className="text-xs font-bold text-white bg-violet-600 hover:bg-violet-500 px-3 py-1.5 rounded-full disabled:opacity-50"
              >
                {coachBusy ? '…' : 'Generate'}
              </button>
            </div>

            {coach?.pinned?.text ? (
              <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">{coach.pinned.text}</div>
            ) : coach?.history?.[0]?.text ? (
              <>
                <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">{coach.history[0].text}</div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void pinCoach(coach.history[0].id);
                    }}
                    disabled={coachBusy}
                    className="text-xs font-bold text-zinc-950 bg-yellow-400 hover:bg-yellow-300 px-3 py-1.5 rounded-full disabled:opacity-50"
                  >
                    Pin
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-3 text-xs text-zinc-500">Generate a focus card and pin it to keep it stable across sessions.</div>
            )}
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
                  <div className="text-[10px] font-mono text-zinc-500">
                    GOAL: {((homeData?.profile?.goal ?? userProfile.goal) ?? '—').toUpperCase()}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-violet-400">
                  {homeData?.latestStats?.weight_lbs != null ? `${homeData.latestStats.weight_lbs} lbs` : '—'}
                </div>
                <div className="text-[10px] text-zinc-500">{bfText}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 divide-x divide-white/5">
              <div className="p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Nutrition Today</div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-zinc-400">Cals</div>
                  <div className="font-mono font-bold">{todaysCals == null ? '—' : Math.round(todaysCals)}</div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-zinc-400">Protein</div>
                  <div className="font-mono font-bold text-emerald-400">{todaysProtein == null ? '—' : Math.round(todaysProtein)}g</div>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Session Log</div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-zinc-400">Booked (next 30d)</div>
                  <div className="font-mono font-bold">{homeLoaded ? (homeData?.sessionLog?.bookedUpcoming30d ?? 0) : '—'}</div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-zinc-400">Completed (last 7d)</div>
                  <div className="font-mono font-bold text-blue-400">{homeLoaded ? (homeData?.sessionLog?.completed7d ?? 0) : '—'}</div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-zinc-400">Missed (approx 30d)</div>
                  <div className="font-mono font-bold text-zinc-600">{homeLoaded ? (homeData?.sessionLog?.missedApprox30d ?? 0) : '—'}</div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="bg-zinc-900/80 p-4 border-zinc-800" onClick={() => setTab('workout')}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Workouts</div>
                <div className="text-sm text-zinc-300">Last 7 days</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-mono text-zinc-400 bg-black/20 border border-white/10 px-2 py-1 rounded">
                  {homeLoaded ? `${homeData?.progress?.workouts7d?.count ?? 0} • ${homeData?.progress?.workouts7d?.minutes ?? 0}m` : '—'}
                </div>
                <div className="text-xs font-bold text-white bg-violet-600 px-3 py-1.5 rounded-full">Log</div>
              </div>
            </div>

            {homeData?.recentWorkouts && homeData.recentWorkouts.length ? (
              <div className="space-y-2">
                {homeData.recentWorkouts.map((w) => (
                  <div key={w.id} className="flex items-center justify-between text-xs">
                    <div className="text-zinc-200 truncate pr-2">
                      {(w.kind || 'workout').toUpperCase()}
                      {w.duration_min != null ? ` • ${w.duration_min}m` : ''}
                    </div>
                    <div className="text-zinc-500 font-mono shrink-0">
                      {new Date(w.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">No workouts logged in the last 7 days. Tap to log one.</div>
            )}
          </Card>

          {/* Things to do today (DB-backed agenda + check-ins) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div>
                <h2 className="font-bold text-lg">Things to do today</h2>
                <div className="text-xs text-zinc-500">Your agenda + check-ins (real data).</div>
              </div>
            </div>

            {homeLoaded ? (
              homeData?.agenda && homeData.agenda.length ? (
                <div className="space-y-2">
                  {homeData.agenda.map((item) => {
                    const icon =
                      item.type === 'Workout' ? (
                        <Dumbbell size={18} />
                      ) : item.type === 'Cardio' ? (
                        <Activity size={18} />
                      ) : item.type === 'Habit' ? (
                        <CheckSquare size={18} />
                      ) : item.type === 'Check-in' ? (
                        <Camera size={18} />
                      ) : (
                        <Clock size={18} />
                      );

                    const jumpIn = () => {
                      if (item.action === 'quicklog') {
                        setShowQuickLog(true);
                        return;
                      }
                      if (item.action === 'progress_photos') {
                        setTab('progress', { mode: 'photos' });
                        return;
                      }
                      setTab(item.action);
                    };

                    return (
                      <Card key={item.id} className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-violet-400 shrink-0">
                            {icon}
                          </div>
                          <div className="min-w-0">
                            <div className={`font-bold text-sm truncate ${item.completed ? 'text-zinc-400 line-through' : ''}`}>{item.title}</div>
                            <div className="text-xs text-zinc-500">
                              {(item.time ? `${item.time} • ` : '') + item.type}
                              {item.completed ? ' • done' : ''}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            jumpIn();
                          }}
                          className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                            item.completed ? 'bg-zinc-800 text-zinc-500' : 'text-white bg-violet-600 hover:bg-violet-500'
                          }`}
                        >
                          {item.completed ? 'View' : 'Jump in'}
                        </button>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card className="p-4">
                  <div className="text-xs text-zinc-500">No agenda items yet. Add habits to see them here.</div>
                </Card>
              )
            ) : (
              <Card className="p-4">
                <div className="text-xs text-zinc-500">Loading…</div>
              </Card>
            )}
          </div>

          {/* Daily Check-in (real data write) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div>
                <h2 className="font-bold text-lg">Daily Check-in</h2>
                <div className="text-xs text-zinc-500">Log weight/body fat and notes.</div>
              </div>
              <button
                onClick={() => setShowQuickLog((prev) => !prev)}
                className="text-xs font-bold text-violet-400 hover:text-violet-200"
              >
                {showQuickLog ? 'Close' : 'Quick Log'}
              </button>
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
                  <input
                    value={statsLog.restingHr}
                    onChange={(event) => setStatsLog({ ...statsLog, restingHr: event.target.value })}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm col-span-2"
                    placeholder="Resting HR (optional)"
                  />
                </div>
                <textarea
                  value={statsLog.note}
                  onChange={(event) => setStatsLog({ ...statsLog, note: event.target.value })}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm h-20 resize-none"
                  placeholder="Progress photo notes, mood, soreness..."
                />
                <div className="space-y-2">
                  <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Progress Photo (optional)</div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                    className="text-xs text-zinc-400"
                  />
                  <input
                    value={photoNote}
                    onChange={(e) => setPhotoNote(e.target.value)}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm w-full"
                    placeholder="Photo note (optional)"
                  />
                </div>

                <div className="flex justify-between items-center text-xs text-zinc-500">
                  <span>Saved to your account.</span>
                  <button
                    onClick={saveCheckin}
                    className="text-xs font-bold text-white bg-emerald-500 px-3 py-1.5 rounded-full"
                  >
                    Save
                  </button>
                </div>
              </Card>
            ) : (
              <Card className="p-4">
                <div className="text-sm text-zinc-300">No check-in form open.</div>
              </Card>
            )}
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
                  const Icon = tile.icon;

                  let value = tile.value;
                  let trend = tile.trend;
                  let onClick: (() => void) | undefined;

                  if (tile.id === 'weight') {
                    value = homeData?.latestStats?.weight_lbs != null ? `${homeData.latestStats.weight_lbs} lb` : '—';
                    trend = 'Log in Daily Check-in';
                    onClick = () => setShowQuickLog(true);
                  }

                  if (tile.id === 'bodyfat') {
                    value = homeData?.latestStats?.body_fat_pct != null ? `${homeData.latestStats.body_fat_pct}%` : '—';
                    trend = 'Log in Daily Check-in';
                    onClick = () => setShowQuickLog(true);
                  }

                  if (tile.id === 'rhr') {
                    value = homeData?.latestStats?.resting_hr != null ? `${homeData.latestStats.resting_hr} bpm` : '—';
                    trend = 'Add in Daily Check-in';
                    onClick = () => setShowQuickLog(true);
                  }

                  if (tile.id === 'nutrition') {
                    const avg = homeData?.progress?.calories7dAvg;
                    value = avg != null ? `${avg} kcal` : '—';
                    trend = '7-day avg';
                    onClick = () => setTab('nutrition');
                  }

                  if (tile.id === 'photos') {
                    value = homeLoaded ? `${homeData?.progress?.photos30d ?? 0}` : '—';
                    trend = 'Photos (30d)';
                    onClick = () => setTab('progress', { mode: 'photos' });
                  }

                  if (tile.id === 'strength') {
                    const pr = homeData?.progress?.latestPr;
                    value = pr ? `${pr.lift}` : '—';
                    trend = pr ? `${pr.value}${pr.unit}${pr.reps ? ` x${pr.reps}` : ''}` : 'Add a PR';
                    onClick = () => setTab('progress', { mode: 'prs' });
                  }

                  return (
                    <Card key={tile.id} className={`p-3 space-y-2 ${onClick ? 'cursor-pointer hover:bg-zinc-800 transition' : ''}`} onClick={onClick}>
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span className="uppercase font-bold tracking-widest">{tile.label}</span>
                        <Icon size={14} className="text-violet-400" />
                      </div>
                      <div className="text-lg font-black">{value}</div>
                      <div className="text-[10px] text-emerald-400">{trend}</div>
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
