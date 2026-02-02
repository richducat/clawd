import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function loginAction(formData: FormData) {
  'use server';

  const code = String(formData.get('code') || '').trim();
  const expected = process.env.LABSTUDIO_ACCESS_CODE || '';

  if (!expected) {
    throw new Error('LABSTUDIO_ACCESS_CODE is not set on the server');
  }

  if (code !== expected) {
    redirect('/login?error=bad_code');
  }

  const nextPath = String(formData.get('next') || '/members');

  // Set a simple session cookie (v0). Later we can sign/encrypt it.
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  jar.set('labstudio_session', 'ok', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect(nextPath);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) || {};
  const error = typeof sp.error === 'string' ? sp.error : '';
  const next = typeof sp.next === 'string' ? sp.next : '/members';

  return (
    <main style={{ padding: 24, maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.5 }}>Lab Studio — Members</h1>
      <p style={{ color: 'var(--muted)' }}>Enter the access code to continue.</p>
      {error ? (
        <p style={{ color: '#fb7185', fontWeight: 700 }}>Invalid code. Try again.</p>
      ) : null}

      <form action={loginAction} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <input type="hidden" name="next" value={next} />
        <input
          name="code"
          placeholder="Access code"
          autoComplete="one-time-code"
          style={{
            padding: 12,
            fontSize: 16,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'rgba(24,24,27,0.6)',
            color: 'var(--foreground)',
          }}
        />
        <button
          type="submit"
          style={{
            padding: 12,
            fontSize: 16,
            fontWeight: 900,
            cursor: 'pointer',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--accent)',
            color: '#04110a',
          }}
        >
          Continue
        </button>
      </form>

      <p style={{ marginTop: 24, color: 'var(--muted)', fontSize: 12 }}>
        v0 access gate (no email). We’ll replace this with proper member signup/login.
      </p>
    </main>
  );
}
