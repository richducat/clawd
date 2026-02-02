import MembersChat from './MembersChat';

export const dynamic = 'force-dynamic';

export default function MembersHome() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 860 }}>
      <h1 style={{ fontSize: 28, fontWeight: 900 }}>Members</h1>
      <p style={{ color: '#555' }}>Toby is live (v1).</p>

      <section style={{ marginTop: 20 }}>
        <MembersChat />
      </section>
    </main>
  );
}
