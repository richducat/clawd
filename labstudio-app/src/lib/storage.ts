export function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore (private mode, full, etc.)
  }
}

export function logEvent(name: string, payload: Record<string, unknown> = {}) {
  // Placeholder telemetry hook (mirrors original). Keep it client-only.
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.info('[Lab Event]', { ts: new Date().toISOString(), name, payload });
  }
}
