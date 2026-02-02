import crypto from 'node:crypto';

const COOKIE_NAME = 'toby_rl';

function etDayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function hmac(secret: string, data: string) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function getRateLimitCookieName() {
  return COOKIE_NAME;
}

export function parseAndVerifyDailyCounter(raw: string | undefined, secret: string) {
  // Format: <day>|<count>|<sig>
  if (!raw) return { day: etDayKey(), count: 0, ok: true };
  const parts = raw.split('|');
  if (parts.length !== 3) return { day: etDayKey(), count: 0, ok: false };
  const [day, countStr, sig] = parts;
  const count = Number(countStr);
  if (!day || !Number.isFinite(count) || count < 0) return { day: etDayKey(), count: 0, ok: false };
  const data = `${day}|${count}`;
  const expected = hmac(secret, data);
  if (sig !== expected) return { day: etDayKey(), count: 0, ok: false };
  return { day, count, ok: true };
}

export function makeSignedDailyCounterCookie({ day, count }: { day: string; count: number }, secret: string) {
  const data = `${day}|${count}`;
  const sig = hmac(secret, data);
  return `${day}|${count}|${sig}`;
}

export function currentEtDayKey() {
  return etDayKey();
}
