import type { QueryEngine } from './query-engine.js';
import type { EmbeddingProvider } from './embedding-provider.js';
import type { StoredEmbedding } from './embedding-store.js';
import { searchEmbeddings } from './semantic-search.js';
import type { RepoIndex } from '../types/index.js';

export type { EmbeddingProvider };

export interface RetrievalResult {
  chunkId: string;
  score:   number;
}

// ── Multi-hop expansion cap ───────────────────────────────────────────────────

/** Maximum total chunks returned after multi-hop expansion. */
const MULTI_HOP_CAP = 10;

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
 *
 * ### Multi-hop expansion (Phase 5)
 *
 * When a `RepoIndex` is supplied, the search expands the initial top-K
 * results by following one hop of the dependency graph:
 *
 *   initial results
 *     → extract file paths
 *     → find files that are imported by, or import, those files
 *     → add their best-ranked chunks up to MULTI_HOP_CAP total
 *
 * Example: a hit on `authController.ts` will also surface `authService.ts`
 * and `tokenService.ts` if they are direct dependencies.
 */
export class HybridRetrieval {
  constructor(
    private queryEngine:        QueryEngine,
    private embeddingProvider?: EmbeddingProvider,
    private embeddingStore?:    StoredEmbedding[],
    private index?:             RepoIndex | null,
  ) {}

  async search(query: string, topK: number): Promise<RetrievalResult[]> {
    const baseResults = await this._baseSearch(query, topK);

    // Multi-hop expansion: only possible when an index is available
    if (this.index && baseResults.length > 0) {
      return this._expandWithDependencies(baseResults, topK);
    }

    return baseResults;
  }

  // ── Base RRF search ───────────────────────────────────────────────────────

  private async _baseSearch(query: string, topK: number): Promise<RetrievalResult[]> {
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

  // ── Multi-hop dependency expansion ────────────────────────────────────────

  /**
   * Expand base results by one dependency hop.
   *
   * For each file in the initial result set:
   *   - Find files that this file imports (outbound edges)
   *   - Find files that import this file (inbound edges)
   *
   * Add the best-ranked chunk from each neighboring file until MULTI_HOP_CAP
   * is reached.  Initial results always take priority.
   */
  private _expandWithDependencies(
    base:  RetrievalResult[],
    topK:  number,
  ): RetrievalResult[] {
    const index = this.index!;
    const cap   = Math.max(topK, MULTI_HOP_CAP);

    // Map chunk IDs to file paths
    const chunkToFile = new Map<string, string>(
      index.chunks.map((c) => [c.id, c.filePath]),
    );

    // Collect file paths from base results
    const baseFiles = new Set<string>();
    for (const r of base) {
      const fp = chunkToFile.get(r.chunkId);
      if (fp) baseFiles.add(fp);
    }

    // Collect neighboring files (one hop)
    const neighborFiles = new Set<string>();
    for (const edge of index.edges) {
      if (baseFiles.has(edge.source) && !baseFiles.has(edge.target)) {
        neighborFiles.add(edge.target); // outbound: authController → authService
      }
      if (baseFiles.has(edge.target) && !baseFiles.has(edge.source)) {
        neighborFiles.add(edge.source); // inbound: files that import our results
      }
    }

    if (neighborFiles.size === 0) return base.slice(0, cap);

    // For each neighbor file, pick the highest-scored chunk via TF-IDF
    // (use a simple heuristic: first chunk in the file by index order)
    const seen    = new Set(base.map((r) => r.chunkId));
    const extras: RetrievalResult[] = [];

    for (const filePath of neighborFiles) {
      if (base.length + extras.length >= cap) break;

      const fileChunks = index.chunks.filter((c) => c.filePath === filePath);
      if (fileChunks.length === 0) continue;

      // Take the first chunk of each neighbor file as a representative
      const best = fileChunks[0];
      if (!seen.has(best.id)) {
        seen.add(best.id);
        extras.push({
          chunkId: best.id,
          // Assign a score slightly below the lowest base result
          score: (base[base.length - 1]?.score ?? 0.1) * 0.9,
        });
      }
    }

    return [...base, ...extras].slice(0, cap);
  }
}
