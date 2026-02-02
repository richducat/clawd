'use client';

import { useEffect, useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import Card from '../components/Card';

type NextBooking = {
  summary: string;
  start: string;
  end: string;
  location: string | null;
  description: string | null;
};

export default function BookView() {
  const [nextBooking, setNextBooking] = useState<NextBooking | null>(null);

  useEffect(() => {
    fetch('/api/lab/home')
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setNextBooking(data.home?.nextBooking ?? null);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4 pb-20">
      <div className="px-1">
        <h1 className="text-2xl font-black italic uppercase">Book</h1>
        <div className="text-xs text-zinc-500 mt-1">
          Backed by a real Google Calendar feed (richducat@gmail.com) for now.
        </div>
      </div>

      {nextBooking ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-violet-400 font-bold text-xs uppercase tracking-widest">
            <Calendar size={14} /> Next session
          </div>
          <div className="font-black text-xl italic mt-2">{nextBooking.summary || 'Session'}</div>
          <div className="flex items-center gap-2 text-sm text-zinc-300 mt-1">
            <Clock size={14} className="text-zinc-500" />
            {new Date(nextBooking.start).toLocaleString()}
          </div>
          {nextBooking.location ? <div className="text-xs text-zinc-500 mt-2">{nextBooking.location}</div> : null}
          {nextBooking.description ? <div className="text-xs text-zinc-500 mt-2">{nextBooking.description}</div> : null}
        </Card>
      ) : (
        <Card className="p-4">
          <div className="text-sm text-zinc-300">No upcoming session found.</div>
          <div className="text-xs text-zinc-500 mt-2">
            Create an event in the “LabStudio - Bookings” Google Calendar and it will appear here.
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="text-sm text-zinc-300">Create a booking (manual for now)</div>
        <div className="text-xs text-zinc-500 mt-2">
          We’ll wire true self-serve booking (slot selection + event creation) once we add Google API OAuth.
        </div>
      </Card>
    </div>
  );
}
