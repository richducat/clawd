'use client';

import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import Card from '../components/Card';

type BusyBooking = {
  id: string;
  start_at: string; // ISO
  end_at: string; // ISO
  kind: string;
  status: 'requested' | 'confirmed' | 'canceled';
  source?: 'db' | 'ical';
  user_id?: string;
};

type MineBooking = BusyBooking;

type BookingsResponse = {
  ok: boolean;
  mine: MineBooking[];
  busy: BusyBooking[];
  error?: string;
};

function fmt(dt: Date) {
  return dt.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && aEnd > bStart;
}

function buildCandidateSlots(day: Date, opts: { startHour: number; endHour: number; durationMin: number; stepMin: number }) {
  const slots: Array<{ start: Date; end: Date }> = [];
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);

  const { startHour, endHour, durationMin, stepMin } = opts;

  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      const start = new Date(d);
      start.setHours(h, m, 0, 0);

      const end = new Date(start.getTime() + durationMin * 60_000);
      if (end.getHours() > endHour || (end.getHours() === endHour && end.getMinutes() > 0)) continue;

      slots.push({ start, end });
    }
  }

  return slots;
}

export default function BookView() {
  const [busy, setBusy] = useState<BusyBooking[]>([]);
  const [mine, setMine] = useState<MineBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [durationMin, setDurationMin] = useState(60);
  const [dayIndex, setDayIndex] = useState(0);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  const days = useMemo(() => {
    const out: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      out.push(new Date(today.getTime() + i * 24 * 60 * 60_000));
    }
    return out;
  }, []);

  const selectedDay = days[Math.min(Math.max(dayIndex, 0), days.length - 1)] ?? new Date();

  const slots = useMemo(() => {
    // NOTE: generated in the browser timezone (members are expected to be ET).
    const candidate = buildCandidateSlots(selectedDay, {
      startHour: 6,
      endHour: 20,
      durationMin,
      stepMin: 30,
    });

    const busyRanges = busy
      .map((b) => ({ s: new Date(b.start_at).getTime(), e: new Date(b.end_at).getTime() }))
      .filter((r) => Number.isFinite(r.s) && Number.isFinite(r.e));

    const now = Date.now();

    return candidate
      .filter(({ start, end }) => end.getTime() > now + 5 * 60_000)
      .filter(({ start, end }) => {
        const s = start.getTime();
        const e = end.getTime();
        return !busyRanges.some((r) => overlaps(s, e, r.s, r.e));
      })
      .slice(0, 40); // keep UI tight
  }, [busy, selectedDay, durationMin]);

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/lab/bookings', { cache: 'no-store' });
      const j = (await res.json()) as BookingsResponse;
      if (!j?.ok) throw new Error(j?.error || 'Failed to load bookings');
      setBusy(Array.isArray(j.busy) ? j.busy : []);
      setMine(Array.isArray(j.mine) ? j.mine : []);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load bookings');
      setBusy([]);
      setMine([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextMine = useMemo(() => {
    const upcoming = mine
      .map((b) => ({ ...b, s: new Date(b.start_at).getTime() }))
      .filter((b) => Number.isFinite(b.s) && b.s > Date.now())
      .sort((a, b) => a.s - b.s);
    return upcoming[0] ?? null;
  }, [mine]);

  const confirmBooking = async () => {
    if (!slotIso) return;

    const start = new Date(slotIso);
    const end = new Date(start.getTime() + durationMin * 60_000);

    setBooking(true);
    setErr(null);
    try {
      const res = await fetch('/api/lab/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ start_at: start.toISOString(), end_at: end.toISOString(), kind: 'session' }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || 'Failed to book');
      setSlotIso(null);
      await refresh();
    } catch (e: any) {
      setErr(e?.message || 'Failed to book');
    } finally {
      setBooking(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="px-1">
        <h1 className="text-2xl font-black italic uppercase">Book</h1>
        <div className="text-xs text-zinc-500 mt-1">Pick a time and reserve it instantly (DB-backed). Calendar sync comes next.</div>
      </div>

      {err ? (
        <Card className="p-4 border border-red-500/30 bg-red-500/10">
          <div className="text-sm text-red-200 font-bold">{err}</div>
        </Card>
      ) : null}

      {/* Next booking */}
      <Card className="p-4">
        <div className="flex items-center gap-2 text-violet-400 font-bold text-xs uppercase tracking-widest">
          <Calendar size={14} /> Next session
        </div>
        {loading ? (
          <div className="text-sm text-zinc-400 mt-2">Loading…</div>
        ) : nextMine ? (
          <>
            <div className="font-black text-xl italic mt-2">{nextMine.kind || 'Session'}</div>
            <div className="flex items-center gap-2 text-sm text-zinc-300 mt-1">
              <Clock size={14} className="text-zinc-500" />
              {fmt(new Date(nextMine.start_at))}
            </div>
            <div className="text-[11px] text-zinc-500 mt-2">Status: {nextMine.status}</div>
          </>
        ) : (
          <div className="text-sm text-zinc-300 mt-2">No upcoming booking yet.</div>
        )}
      </Card>

      {/* Slot picker */}
      <Card className="p-4 space-y-3">
        <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Pick a slot</div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-400">Duration</label>
          <select
            value={durationMin}
            onChange={(e) => {
              setDurationMin(Number(e.target.value));
              setSlotIso(null);
            }}
            className="bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-sm"
          >
            <option value={30}>30 min</option>
            <option value={60}>60 min</option>
            <option value={90}>90 min</option>
          </select>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((d, idx) => {
            const active = idx === dayIndex;
            const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => {
                  setDayIndex(idx);
                  setSlotIso(null);
                }}
                className={`shrink-0 text-xs font-black px-3 py-2 rounded-xl border ${active ? 'bg-yellow-400 text-zinc-950 border-yellow-400' : 'bg-zinc-900 text-zinc-200 border-white/10'}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="text-sm text-zinc-400">Loading availability…</div>
        ) : slots.length ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {slots.map(({ start, end }) => {
              const iso = start.toISOString();
              const active = iso === slotIso;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSlotIso(iso)}
                  className={`text-xs font-black px-3 py-3 rounded-xl border ${active ? 'bg-white text-zinc-950 border-white' : 'bg-zinc-900 text-zinc-200 border-white/10 hover:border-yellow-500/30'}`}
                >
                  {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  <div className="text-[10px] font-mono opacity-70">→ {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-zinc-400">No open slots for this day.</div>
        )}

        <button
          type="button"
          disabled={!slotIso || booking}
          onClick={confirmBooking}
          className="w-full text-xs font-black text-zinc-950 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 px-3 py-3 rounded-xl"
        >
          {booking ? 'Booking…' : 'Book this slot'}
        </button>

        <div className="text-[11px] text-zinc-500">
          Notes: availability is computed from existing bookings + the current “LabStudio - Bookings” calendar feed.
        </div>
      </Card>

      {/* My bookings list */}
      <Card className="p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Your upcoming bookings</div>
        {loading ? (
          <div className="text-sm text-zinc-400 mt-2">Loading…</div>
        ) : mine.filter((b) => new Date(b.end_at).getTime() > Date.now()).length ? (
          <div className="mt-3 space-y-2">
            {mine
              .filter((b) => new Date(b.end_at).getTime() > Date.now())
              .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
              .slice(0, 10)
              .map((b) => (
                <div key={b.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold truncate">{fmt(new Date(b.start_at))}</div>
                    <div className="text-[11px] text-zinc-500">{b.kind} • {b.status}</div>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-400 mt-2">None yet.</div>
        )}
      </Card>
    </div>
  );
}
