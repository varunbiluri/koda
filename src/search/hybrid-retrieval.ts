import type { QueryEngine } from './query-engine.js';
import type { EmbeddingProvider } from './embedding-provider.js';
import type { StoredEmbedding } from './embedding-store.js';
import { searchEmbeddings } from './semantic-search.js';

export type { EmbeddingProvider };

export interface RetrievalResult {
  chunkId: string;
  score:   number;
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
  tfidfRanks:     Array<{ id: string; score: number }>,
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
 * HybridRetrieval — combines TF-IDF (via QueryEngine) with optional dense
 * embedding search using Reciprocal Rank Fusion (RRF, k=60).
 *
 * When no embeddingProvider or embeddingStore is supplied the search falls
 * back gracefully to TF-IDF only.  When an embedding provider is present
 * but the network call fails, TF-IDF is also used as the fallback so the
 * caller always gets results.
 */
export class HybridRetrieval {
  constructor(
    private queryEngine:       QueryEngine,
    private embeddingProvider?: EmbeddingProvider,
    private embeddingStore?:    StoredEmbedding[],
  ) {}

  async search(query: string, topK: number): Promise<RetrievalResult[]> {
    // TF-IDF path (always available)
    const tfidfResults = this.queryEngine.search(query, topK * 2);

    // Fall back to TF-IDF when embedding infrastructure is not ready
    if (
      !this.embeddingProvider ||
      !this.embeddingStore    ||
      this.embeddingStore.length === 0
    ) {
      return tfidfResults.slice(0, topK).map((r) => ({
        chunkId: r.chunkId,
        score:   r.score,
      }));
    }

    // Dense embedding search — failure is non-fatal
    let embeddingResults: Array<{ chunkId: string; score: number }> = [];
    try {
      const queryVector = await this.embeddingProvider.embed(query);
      embeddingResults  = searchEmbeddings(queryVector, this.embeddingStore, topK * 2);
    } catch {
      // Network or config error — degrade to TF-IDF
      return tfidfResults.slice(0, topK).map((r) => ({
        chunkId: r.chunkId,
        score:   r.score,
      }));
    }

    // RRF fusion
    const tfidfRanks     = tfidfResults.map((r) => ({ id: r.chunkId, score: r.score }));
    const embeddingRanks = embeddingResults.map((r) => ({ id: r.chunkId, score: r.score }));
    const fused          = reciprocalRankFusion(tfidfRanks, embeddingRanks);

    // Map fused IDs back to a uniform result shape
    const tfidfById   = new Map(tfidfResults.map((r) => [r.chunkId, r.score]));
    const embById     = new Map(embeddingResults.map((r) => [r.chunkId, r.score]));

    return fused.slice(0, topK).map(({ id, fusedScore }) => ({
      chunkId: id,
      // Expose the RRF score; callers that need the original scores can look
      // them up through the index.
      score: fusedScore,
      // Keep a trace of original scores for debugging (optional)
      _tfidfScore: tfidfById.get(id),
      _embScore:   embById.get(id),
    })) as RetrievalResult[];
  }
}
