// Optional helper. If OPENAI_API_KEY is not set, callers should degrade gracefully.

export async function embedTextOpenAI(text, {
  model = 'text-embedding-3-small',
  apiKey = process.env.OPENAI_API_KEY,
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI embeddings failed (${res.status}): ${body}`);
  }

  const json = await res.json();
  const vec = json?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('OpenAI embeddings: missing embedding');
  return vec;
}
