export const dynamic = 'force-dynamic';

export default function MembersHome() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 860 }}>
      <h1 style={{ fontSize: 28, fontWeight: 900 }}>Members</h1>
      <p style={{ color: '#555' }}>
        You’re in. Next: wire Toby chat (OpenAI) + real accounts.
      </p>

      <section style={{ marginTop: 20, padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>Toby (v0)</h2>
        <p style={{ color: '#666' }}>
          Backend + storage coming next. For now this confirms the gate + routing work.
        </p>
      </section>
    </main>
  );
}
