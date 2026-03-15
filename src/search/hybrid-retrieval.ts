import type { QueryEngine } from './query-engine.js';

/** Minimal interface for any embedding provider. */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

/**
 * Reciprocal Rank Fusion (RRF) combiner.
 *
 * Given two ranked lists (TF-IDF and embedding), computes a fused score:
 *   score(d) = Σ  1 / (k + rank(d))   for each ranking list
 *
 * @param tfidfRanks     - Results from TF-IDF search, ordered best-first.
 * @param embeddingRanks - Results from embedding search, ordered best-first.
 * @param k              - RRF constant (default 60). Higher k reduces the
 *                         influence of very top-ranked items.
 * @returns Sorted array of fused scores, highest first.
 */
export function reciprocalRankFusion(
  tfidfRanks: Array<{ id: string; score: number }>,
  embeddingRanks: Array<{ id: string; score: number }>,
  k = 60,
): Array<{ id: string; fusedScore: number }> {
  const scores = new Map<string, number>();

  const addRank = (list: Array<{ id: string; score: number }>): void => {
    list.forEach(({ id }, idx) => {
      const rank = idx + 1; // 1-indexed
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    });
  };

  addRank(tfidfRanks);
  addRank(embeddingRanks);

  return Array.from(scores.entries())
    .map(([id, fusedScore]) => ({ id, fusedScore }))
    .sort((a, b) => b.fusedScore - a.fusedScore);
}

/**
 * HybridRetrieval — combines TF-IDF (via QueryEngine) and optional dense
 * embedding search using RRF fusion.
 *
 * When no embeddingProvider is supplied the search falls back to TF-IDF only.
 * This lets the class be used today while the embedding infrastructure is
 * being built out.
 */
export class HybridRetrieval {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private queryEngine: QueryEngine,
    private embeddingProvider?: EmbeddingProvider,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async search(query: string, topK: number): Promise<any[]> {
    // TF-IDF search (always available)
    const tfidfResults = this.queryEngine.search(query, topK * 2);

    if (!this.embeddingProvider) {
      // No embedding provider — return TF-IDF results directly
      return tfidfResults.slice(0, topK);
    }

    // Dense embedding search
    const queryEmbedding = await this.embeddingProvider.embed(query);

    // Placeholder: in a full implementation, queryEmbedding would be used to
    // search a vector store containing pre-computed chunk embeddings. Until that
    // store exists, the embedding path degrades gracefully to TF-IDF only.
    void queryEmbedding; // suppress unused-variable warning

    // Build ranked lists for RRF
    const tfidfRanks = tfidfResults.map((r) => ({ id: r.chunkId, score: r.score }));

    // embeddingRanks would come from a dense vector store search here.
    // For now, supply an empty list so RRF still returns TF-IDF results.
    const embeddingRanks: Array<{ id: string; score: number }> = [];

    const fused = reciprocalRankFusion(tfidfRanks, embeddingRanks);

    // Map fused ids back to original search results
    const resultByChunkId = new Map(tfidfResults.map((r) => [r.chunkId, r]));
    return fused
      .slice(0, topK)
      .map(({ id }) => resultByChunkId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
  }
}
