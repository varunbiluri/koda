import type { StoredEmbedding } from './embedding-store.js';

export interface SemanticSearchResult {
  chunkId: string;
  score:   number;
}

/**
 * Compute cosine similarity between two dense vectors.
 * Returns 0 for mismatched lengths or zero-norm vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot   = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot   += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Brute-force cosine similarity search over a pre-built embedding store.
 *
 * For repositories up to ~10 000 chunks this is fast enough in practice
 * (< 20 ms for a 1536-dim ada-002 embedding against 5000 chunks on V8).
 * An ANN index (e.g. HNSW) would be needed beyond that scale.
 *
 * @param queryVector - Dense embedding of the user query.
 * @param store       - Stored chunk embeddings to search against.
 * @param topK        - Number of highest-scoring results to return.
 */
export function searchEmbeddings(
  queryVector: number[],
  store:       StoredEmbedding[],
  topK:        number,
): SemanticSearchResult[] {
  if (queryVector.length === 0 || store.length === 0) return [];

  const scored = store.map((entry) => ({
    chunkId: entry.chunkId,
    score:   cosineSimilarity(queryVector, entry.vector),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
