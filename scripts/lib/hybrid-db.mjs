import crypto from 'node:crypto';

// Minimal, reusable “hybrid DB” helpers:
// - deterministic ids
// - embeddings stored as JSON arrays (vector column equivalent)
// - cosine similarity in JS (keeps dependencies light)

export function stableId(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 24);
}

export function toEmbeddingJson(vec) {
  if (!vec) return null;
  if (!Array.isArray(vec)) throw new Error('embedding must be an array');
  return JSON.stringify(vec);
}

export function fromEmbeddingJson(json) {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : null;
}
