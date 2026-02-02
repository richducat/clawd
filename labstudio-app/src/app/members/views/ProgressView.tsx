'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '../components/Card';

type Mode = 'photos' | 'prs';

export default function ProgressView({ mode, onBack }: { mode: Mode; onBack: () => void }) {
  const [photos, setPhotos] = useState<Array<{ id: number; created_at: string; note: string | null; image_data_url: string }> | null>(null);
  const [prs, setPrs] = useState<{
    latest: { id: number; created_at: string; lift: string; value: number; unit: string; reps: number | null } | null;
    history: Array<{ id: number; created_at: string; lift: string; value: number; unit: string; reps: number | null }>;
  } | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        if (mode === 'photos') {
          const r = await fetch('/api/lab/progress-photos');
          const j = await r.json();
          if (!mounted) return;
          if (j?.ok) setPhotos(j.photos || []);
        } else {
          const r = await fetch('/api/lab/strength-prs');
          const j = await r.json();
          if (!mounted) return;
          if (j?.ok) setPrs({ latest: j.latest ?? null, history: j.history ?? [] });
        }
      } catch {
        // ignore
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [mode]);

  const title = useMemo(() => (mode === 'photos' ? 'Progress Photos' : 'Strength PRs'), [mode]);

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-zinc-500 tracking-widest uppercase">Progress</div>
          <div className="text-2xl font-black italic uppercase">{title}</div>
        </div>
        <button
          onClick={onBack}
          className="text-xs font-bold text-white bg-zinc-800 hover:bg-zinc-700 px-3 py-2 rounded-xl"
        >
          Back
        </button>
      </div>

      {mode === 'photos' ? (
        <>
          <div className="text-xs text-zinc-500">Latest 10 photos saved from Daily Check-in.</div>
          {photos && photos.length ? (
            <div className="grid grid-cols-2 gap-3">
              {photos.map((p) => (
                <Card key={p.id} className="p-2 space-y-2">
                  <img
                    src={p.image_data_url}
                    alt={p.note || 'Progress photo'}
                    className="w-full h-44 object-cover rounded-xl border border-white/5"
                  />
                  <div className="text-[10px] text-zinc-500 font-mono">{new Date(p.created_at).toLocaleDateString()}</div>
                  {p.note ? <div className="text-xs text-zinc-300">{p.note}</div> : null}
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-4">
              <div className="text-sm text-zinc-300">No photos yet.</div>
              <div className="text-xs text-zinc-500 mt-1">Add one from Home → Daily Check-in.</div>
            </Card>
          )}
        </>
      ) : (
        <>
          <div className="text-xs text-zinc-500">Latest + history (up to 20). Add PRs from Workout tab.</div>
          {prs?.history?.length ? (
            <div className="space-y-2">
              {prs.history.map((p) => (
                <Card key={p.id} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-zinc-100">{p.lift}</div>
                    <div className="text-xs text-zinc-500 font-mono">{new Date(p.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-emerald-400">
                      {p.value}
                      {p.unit}
                      {p.reps ? ` x${p.reps}` : ''}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-4">
              <div className="text-sm text-zinc-300">No PRs yet.</div>
              <div className="text-xs text-zinc-500 mt-1">Add one from Workout → Log a Strength PR.</div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
