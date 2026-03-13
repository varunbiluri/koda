import type { RepoIndex, SearchResult, CodeChunk } from '../types/index.js';
import { VectorStore } from '../store/vector-store.js';
import { embedQuery } from '../engine/embeddings/tfidf-embedder.js';
import { tokenize } from '../engine/embeddings/tokenizer.js';

export class QueryEngine {
  private vectorStore: VectorStore;
  private index: RepoIndex;

  constructor(index: RepoIndex) {
    this.index = index;
    this.vectorStore = new VectorStore();
    this.vectorStore.load(index.vectors);
  }

  search(query: string, topK: number = 10): SearchResult[] {
    const queryVector = embedQuery(query, this.index.vocabulary, this.index.chunks.length);

    // Get initial results from vector search (fetch more than needed for re-ranking)
    const candidates = this.vectorStore.search(queryVector, topK * 3);

    // Re-rank with boosts
    const queryTokens = new Set(tokenize(query));
    const reranked = candidates.map(result => {
      let score = result.score;

      const chunk = this.index.chunks.find(c => c.id === result.chunkId);
      if (!chunk) return result;

      // Name match boost: if query tokens appear in the chunk name
      score += this.nameMatchBoost(chunk, queryTokens);

      // Dependency graph boost: files with higher in-degree are more "important"
      score += this.dependencyBoost(chunk);

      return { ...result, score };
    });

    reranked.sort((a, b) => b.score - a.score);
    return reranked.slice(0, topK);
  }

  private nameMatchBoost(chunk: CodeChunk, queryTokens: Set<string>): number {
    const nameTokens = tokenize(chunk.name);
    let matches = 0;
    for (const token of nameTokens) {
      if (queryTokens.has(token)) matches++;
    }
    if (nameTokens.length === 0) return 0;
    return (matches / nameTokens.length) * 0.3; // Up to 0.3 boost
  }

  private dependencyBoost(chunk: CodeChunk): number {
    const node = this.index.nodes.find(n => n.filePath === chunk.filePath);
    if (!node) return 0;
    // Log scale boost based on in-degree (how many files import this file)
    return Math.log2(1 + node.inDegree) * 0.05; // Mild boost
  }
}
