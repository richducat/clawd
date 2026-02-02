import MembersChat from './MembersChat';

export const dynamic = 'force-dynamic';

export default function MembersHome() {
  return (
    <main style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 950, letterSpacing: -0.6 }}>Members</h1>
      <p style={{ color: 'var(--muted)', marginTop: 6 }}>Toby is live (v1).</p>

      <section style={{ marginTop: 18 }}>
        <MembersChat />
      </section>
    </main>
  );
}
