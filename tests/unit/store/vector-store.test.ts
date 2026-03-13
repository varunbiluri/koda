import { describe, it, expect } from 'vitest';
import { VectorStore } from '../../../src/store/vector-store.js';
import type { VectorEntry, SparseVector } from '../../../src/types/index.js';

describe('VectorStore', () => {
  it('returns results sorted by cosine similarity', () => {
    const store = new VectorStore();

    const entries: VectorEntry[] = [
      { chunkId: 'a', vector: { indices: [0, 1], values: [1.0, 0.0] } },
      { chunkId: 'b', vector: { indices: [0, 1], values: [0.5, 0.5] } },
      { chunkId: 'c', vector: { indices: [0, 1], values: [0.1, 1.0] } },
    ];

    store.load(entries);

    const query: SparseVector = { indices: [0, 1], values: [1.0, 0.0] };
    const results = store.search(query, 3);

    expect(results).toHaveLength(3);
    expect(results[0].chunkId).toBe('a');
    expect(results[1].chunkId).toBe('b');
    expect(results[2].chunkId).toBe('c');
  });

  it('respects topK limit', () => {
    const store = new VectorStore();

    const entries: VectorEntry[] = [
      { chunkId: 'a', vector: { indices: [0], values: [1.0] } },
      { chunkId: 'b', vector: { indices: [0], values: [0.8] } },
      { chunkId: 'c', vector: { indices: [0], values: [0.5] } },
    ];

    store.load(entries);

    const query: SparseVector = { indices: [0], values: [1.0] };
    const results = store.search(query, 2);
    expect(results).toHaveLength(2);
  });

  it('handles no matches', () => {
    const store = new VectorStore();
    store.load([
      { chunkId: 'a', vector: { indices: [0], values: [1.0] } },
    ]);

    const query: SparseVector = { indices: [1], values: [1.0] };
    const results = store.search(query, 10);
    expect(results).toHaveLength(0);
  });
});
