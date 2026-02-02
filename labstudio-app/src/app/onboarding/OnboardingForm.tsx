'use client';

import { useEffect, useMemo, useState } from 'react';

type ProfilePayload = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  goal: string;
  activity_level: string;
  schedule_days: string[];
  nutrition_rating: number | null;
  injuries_json: unknown;
};

const DAYS: Array<{ key: string; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

function inputClassName(disabled?: boolean) {
  return cx(
    'w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-zinc-50 placeholder:text-zinc-500',
    'outline-none focus:border-zinc-600 focus:ring-2 focus:ring-green-500/20',
    disabled && 'opacity-60 cursor-not-allowed'
  );
}

export default function OnboardingForm() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<ProfilePayload>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    goal: '',
    activity_level: 'moderate',
    schedule_days: [],
    nutrition_rating: 5,
    injuries_json: [],
  });

  const [injuriesText, setInjuriesText] = useState('');

  const progress = useMemo(() => {
    const total = 3;
    return Math.round((Math.min(Math.max(step, 1), total) / total) * 100);
  }, [step]);

  function errMsg(e: unknown) {
    return e instanceof Error ? e.message : 'Something went wrong';
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/lab/profile', { method: 'GET' });
        const json: unknown = await res.json().catch(() => null);
        const data = (json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null) as
          | Record<string, unknown>
          | null;
        if (!res.ok) {
          const apiErr = data && typeof data.error === 'string' ? data.error : null;
          throw new Error(apiErr || 'Failed to load profile');
        }

        const profileRaw = data?.profile;
        if (!cancelled && profileRaw && typeof profileRaw === 'object' && !Array.isArray(profileRaw)) {
          const p = profileRaw as Record<string, unknown>;

          const scheduleDays = Array.isArray(p.schedule_days)
            ? p.schedule_days.map((d) => String(d)).filter(Boolean)
            : [];

          setForm((prev) => ({
            ...prev,
            first_name: typeof p.first_name === 'string' ? p.first_name : '',
            last_name: typeof p.last_name === 'string' ? p.last_name : '',
            email: typeof p.email === 'string' ? p.email : '',
            phone: typeof p.phone === 'string' ? p.phone : '',
            goal: typeof p.goal === 'string' ? p.goal : '',
            activity_level: typeof p.activity_level === 'string' ? p.activity_level : 'moderate',
            schedule_days: scheduleDays,
            nutrition_rating: typeof p.nutrition_rating === 'number' ? p.nutrition_rating : 5,
            injuries_json: p.injuries_json ?? [],
          }));

          const ij = p.injuries_json;
          if (Array.isArray(ij)) {
            setInjuriesText(ij.map((x) => String(x)).join('\n'));
          } else if (typeof ij === 'string') {
            setInjuriesText(ij);
          } else if (ij && typeof ij === 'object') {
            setInjuriesText(JSON.stringify(ij, null, 2));
          }
        }
      } catch (e: unknown) {
        if (!cancelled) setError(errMsg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof ProfilePayload>(key: K, value: ProfilePayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDay(dayKey: string) {
    setForm((prev) => {
      const exists = prev.schedule_days.includes(dayKey);
      return {
        ...prev,
        schedule_days: exists ? prev.schedule_days.filter((d) => d !== dayKey) : [...prev.schedule_days, dayKey],
      };
    });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);

    const injuries = injuriesText
      .split(/\n|,/g)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch('/api/lab/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          schedule_days: form.schedule_days,
          injuries_json: injuries,
        }),
      });

      const json: unknown = await res.json().catch(() => null);
      const data = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
      if (!res.ok) {
        const apiErr = data && typeof data.error === 'string' ? data.error : null;
        throw new Error(apiErr || 'Failed to save');
      }

      window.location.href = '/members';
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  }

  const canNextStep1 = form.first_name.trim() && form.last_name.trim();
  const canNextStep2 = form.goal.trim().length >= 3;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-6 shadow-xl">
      <div className="mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-semibold text-zinc-300">Step {step} of 3</div>
          <div className="text-xs text-zinc-500">{progress}%</div>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-900">
          <div className="h-full bg-green-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-zinc-400">Loading…</div>
      ) : (
        <>
          {step === 1 ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-zinc-300">First name *</label>
                  <input
                    className={inputClassName(submitting)}
                    value={form.first_name}
                    onChange={(e) => set('first_name', e.target.value)}
                    disabled={submitting}
                    placeholder="Jane"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-zinc-300">Last name *</label>
                  <input
                    className={inputClassName(submitting)}
                    value={form.last_name}
                    onChange={(e) => set('last_name', e.target.value)}
                    disabled={submitting}
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-zinc-300">Email</label>
                  <input
                    className={inputClassName(submitting)}
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    disabled={submitting}
                    placeholder="jane@example.com"
                    inputMode="email"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-zinc-300">Phone</label>
                  <input
                    className={inputClassName(submitting)}
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    disabled={submitting}
                    placeholder="(555) 123-4567"
                    inputMode="tel"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-zinc-300">Primary goal *</label>
                <textarea
                  className={cx(inputClassName(submitting), 'min-h-[110px] resize-y')}
                  value={form.goal}
                  onChange={(e) => set('goal', e.target.value)}
                  disabled={submitting}
                  placeholder="e.g., lose 15 lbs, get stronger, reduce back pain, train 3x/week"
                />
                <div className="mt-2 text-xs text-zinc-500">A sentence or two is perfect.</div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-zinc-300">Current activity level</label>
                <select
                  className={inputClassName(submitting)}
                  value={form.activity_level}
                  onChange={(e) => set('activity_level', e.target.value)}
                  disabled={submitting}
                >
                  <option value="sedentary">Mostly sedentary</option>
                  <option value="light">Light (1–2 days/week)</option>
                  <option value="moderate">Moderate (3–4 days/week)</option>
                  <option value="high">High (5+ days/week)</option>
                </select>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-6">
              <div>
                <label className="mb-2 block text-sm font-semibold text-zinc-300">Preferred training days</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => {
                    const selected = form.schedule_days.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        disabled={submitting}
                        onClick={() => toggleDay(d.key)}
                        className={cx(
                          'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                          selected
                            ? 'border-green-500 bg-green-500/20 text-green-200'
                            : 'border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700',
                          submitting && 'opacity-60'
                        )}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-zinc-300">Nutrition self-rating</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={form.nutrition_rating ?? 5}
                    disabled={submitting}
                    onChange={(e) => set('nutrition_rating', Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="w-10 text-right text-sm font-bold text-zinc-200">
                    {form.nutrition_rating ?? 5}
                  </div>
                </div>
                <div className="mt-2 text-xs text-zinc-500">1 = needs work, 10 = dialed in.</div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-zinc-300">
                  Injuries / pain / limitations
                </label>
                <textarea
                  className={cx(inputClassName(submitting), 'min-h-[110px] resize-y')}
                  value={injuriesText}
                  onChange={(e) => setInjuriesText(e.target.value)}
                  disabled={submitting}
                  placeholder={'e.g.\n- right knee pain when running\n- tight shoulders\n- lower back history'}
                />
                <div className="mt-2 text-xs text-zinc-500">Optional. One per line is best.</div>
              </div>
            </div>
          ) : null}

          <div className="mt-8 flex items-center justify-between gap-4">
            <button
              type="button"
              className={cx(
                'rounded-xl border border-zinc-800 bg-transparent px-4 py-3 text-sm font-black text-zinc-200',
                'hover:border-zinc-700',
                (step === 1 || submitting) && 'opacity-50 cursor-not-allowed'
              )}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1 || submitting}
            >
              Back
            </button>

            {step < 3 ? (
              <button
                type="button"
                className={cx(
                  'rounded-xl border border-green-500 bg-green-500 px-4 py-3 text-sm font-black text-zinc-950',
                  'hover:bg-green-400 hover:border-green-400',
                  submitting && 'opacity-60 cursor-not-allowed'
                )}
                onClick={() => setStep((s) => Math.min(3, s + 1))}
                disabled={
                  submitting ||
                  (step === 1 && !canNextStep1) ||
                  (step === 2 && !canNextStep2)
                }
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className={cx(
                  'rounded-xl border border-green-500 bg-green-500 px-4 py-3 text-sm font-black text-zinc-950',
                  'hover:bg-green-400 hover:border-green-400',
                  submitting && 'opacity-60 cursor-not-allowed'
                )}
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? 'Saving…' : 'Finish'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
