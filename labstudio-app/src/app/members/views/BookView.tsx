'use client';

import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import Card from '../components/Card';

type NextBooking = {
  summary: string;
  start: string;
  end: string;
  location: string | null;
  description: string | null;
};

type UserBooking = {
  id: number;
  day: string;
  time_label: string;
  duration_min: number;
  status: string;
  note: string | null;
};

type AvailabilityDay = {
  day: string;
  slots: Array<{ time_label: string; available: boolean }>;
};

export default function BookView() {
  const [nextBooking, setNextBooking] = useState<NextBooking | null>(null);
  const [bookings, setBookings] = useState<UserBooking[] | null>(null);
  const [availability, setAvailability] = useState<AvailabilityDay[] | null>(null);
  const [note, setNote] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    setErr(null);

    fetch('/api/lab/home')
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setNextBooking(data.home?.nextBooking ?? null);
      })
      .catch(() => {});

    fetch('/api/lab/bookings')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setBookings(j.bookings ?? []);
        else setBookings([]);
      })
      .catch(() => setBookings([]));

    fetch('/api/lab/bookings/availability?days=10')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setAvailability(j.availability ?? []);
        else setAvailability([]);
      })
      .catch(() => setAvailability([]));
  };

  useEffect(() => {
    refresh();
  }, []);

  const nextRequested = useMemo(() => {
    if (!bookings?.length) return null;
    return bookings[0];
  }, [bookings]);

  const requestBooking = async (day: string, time_label: string) => {
    const key = `${day}|${time_label}`;
    setBusyKey(key);
    setErr(null);
    try {
      const res = await fetch('/api/lab/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day, time_label, note: note.trim() || null }),
      });
      const j = await res.json();
      if (!j?.ok) {
        setErr(String(j?.error || 'Failed to create booking'));
        return;
      }
      setNote('');
      refresh();
    } catch {
      setErr('Failed to create booking');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="px-1">
        <h1 className="text-2xl font-black italic uppercase">Book</h1>
        <div className="text-xs text-zinc-500 mt-1">Request a session + see upcoming bookings (ET).</div>
      </div>

      {err ? (
        <Card className="p-4 border border-red-500/20">
          <div className="text-sm text-red-300 font-bold">{err}</div>
        </Card>
      ) : null}

      {/* Calendar feed (legacy) */}
      {nextBooking ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-violet-400 font-bold text-xs uppercase tracking-widest">
            <Calendar size={14} /> Next session (calendar)
          </div>
          <div className="font-black text-xl italic mt-2">{nextBooking.summary || 'Session'}</div>
          <div className="flex items-center gap-2 text-sm text-zinc-300 mt-1">
            <Clock size={14} className="text-zinc-500" />
            {new Date(nextBooking.start).toLocaleString()}
          </div>
          {nextBooking.location ? <div className="text-xs text-zinc-500 mt-2">{nextBooking.location}</div> : null}
          {nextBooking.description ? <div className="text-xs text-zinc-500 mt-2">{nextBooking.description}</div> : null}
        </Card>
      ) : null}

      {/* Your bookings */}
      <Card className="p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Your bookings</div>

        {bookings === null ? (
          <div className="text-sm text-zinc-300 mt-2">Loading…</div>
        ) : bookings.length === 0 ? (
          <div className="text-sm text-zinc-300 mt-2">No upcoming bookings.</div>
        ) : (
          <div className="mt-3 space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold">
                    {b.day} @ {b.time_label} ET
                  </div>
                  <div className="text-xs text-zinc-500">Status: {b.status}</div>
                  {b.note ? <div className="text-xs text-zinc-500 mt-1">Note: {b.note}</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {nextRequested ? <div className="text-[11px] text-zinc-500 mt-3">Tip: if you need to change a booking, message the coach for now.</div> : null}
      </Card>

      {/* Request a slot */}
      <Card className="p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Request a session</div>
        <div className="text-xs text-zinc-500 mt-2">Pick an open slot below. We’ll confirm/adjust if needed.</div>

        <div className="mt-3">
          <div className="text-xs text-zinc-500 mb-2">Optional note</div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g., lower body focus / shoulder friendly"
            className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-sm"
          />
        </div>

        {availability === null ? (
          <div className="text-sm text-zinc-300 mt-3">Loading availability…</div>
        ) : availability.length === 0 ? (
          <div className="text-sm text-zinc-300 mt-3">No availability configured.</div>
        ) : (
          <div className="mt-4 space-y-3">
            {availability.map((d) => (
              <div key={d.day}>
                <div className="text-xs font-bold text-zinc-400">{d.day}</div>
                {d.slots.length === 0 ? (
                  <div className="text-xs text-zinc-600 mt-1">No slots.</div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {d.slots.map((s) => {
                      const key = `${d.day}|${s.time_label}`;
                      const disabled = !s.available || busyKey === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={disabled}
                          className={`text-xs font-black px-3 py-2 rounded-xl border ${
                            s.available
                              ? 'bg-yellow-400 text-zinc-950 border-yellow-400 hover:bg-yellow-300'
                              : 'bg-white/5 text-zinc-500 border-white/10'
                          } disabled:opacity-50`}
                          onClick={() => requestBooking(d.day, s.time_label)}
                        >
                          {s.time_label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
