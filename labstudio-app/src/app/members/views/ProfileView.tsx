'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '../components/Card';

type Profile = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  goal?: string | null;
};

export default function ProfileView() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/lab/profile')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setProfile(j.profile ?? null);
        else setLoadError(j?.error ?? 'Unable to load profile');
      })
      .catch(() => setLoadError('Unable to load profile'));
  }, []);

  const name = useMemo(() => {
    const n = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
    return n || 'Athlete';
  }, [profile?.first_name, profile?.last_name]);

  return (
    <div className="space-y-4 pb-20">
      <div className="px-1">
        <h1 className="text-2xl font-black italic uppercase">Me</h1>
        <div className="text-xs text-zinc-500 mt-1">Your profile details.</div>
      </div>

      {loadError ? (
        <Card className="p-4">
          <div className="text-sm text-zinc-300">{loadError}</div>
        </Card>
      ) : null}

      <Card className="p-4 space-y-2">
        <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Profile</div>
        <div className="text-lg font-black italic">{name}</div>
        <div className="text-xs text-zinc-500">Email: {profile?.email || '—'}</div>
        <div className="text-xs text-zinc-500">Phone: {profile?.phone || '—'}</div>
        <div className="text-xs text-zinc-500">Goal: {profile?.goal || '—'}</div>
      </Card>

      <Card className="p-4">
        <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Memberships</div>
        <div className="mt-1 text-sm text-zinc-300">Go to the Shop tab to view passes/memberships and checkout.</div>
      </Card>
    </div>
  );
}
