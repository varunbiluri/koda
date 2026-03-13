import type { SparseVector, VectorEntry, SearchResult } from '../types/index.js';

export class VectorStore {
  private entries: VectorEntry[] = [];

  load(entries: VectorEntry[]): void {
    this.entries = entries;
  }

  getEntries(): VectorEntry[] {
    return this.entries;
  }

  search(query: SparseVector, topK: number): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entry of this.entries) {
      const score = cosineSimilarity(query, entry.vector);
      if (score > 0) {
        results.push({ chunkId: entry.chunkId, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
}

function cosineSimilarity(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  let ai = 0;
  let bi = 0;

  // Since both are sorted by index, use merge-join
  while (ai < a.indices.length && bi < b.indices.length) {
    if (a.indices[ai] === b.indices[bi]) {
      dot += a.values[ai] * b.values[bi];
      ai++;
      bi++;
    } else if (a.indices[ai] < b.indices[bi]) {
      ai++;
    } else {
      bi++;
    }
  }

  if (dot === 0) return 0;

  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;

  return dot / (magA * magB);
}

function magnitude(v: SparseVector): number {
  let sum = 0;
  for (const val of v.values) {
    sum += val * val;
  }
  return Math.sqrt(sum);
}
