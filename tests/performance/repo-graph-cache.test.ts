/**
 * RepoGraphCache — unit tests
 */

import { describe, it, expect } from 'vitest';
import { RepoGraphCache } from '../../src/performance/repo-graph-cache.js';

describe('RepoGraphCache.hashContent', () => {
  it('returns a 64-char hex string', () => {
    expect(RepoGraphCache.hashContent('test')).toHaveLength(64);
  });

  it('is deterministic', () => {
    expect(RepoGraphCache.hashContent('x')).toBe(RepoGraphCache.hashContent('x'));
  });
});

describe('RepoGraphCache set/get', () => {
  async function fresh() {
    return RepoGraphCache.load('/tmp/koda-rgc-' + Date.now());
  }

  it('returns undefined on cache miss', async () => {
    const cache = await fresh();
    expect(cache.getEdges('nosuchhash')).toBeUndefined();
  });

  it('stores and retrieves edge lists', async () => {
    const cache = await fresh();
    cache.setEdges('hash1', 'src/a.ts', ['src/b.ts', 'src/c.ts']);
    const hit = cache.getEdges('hash1');
    expect(hit).toBeDefined();
    expect(hit!.imports).toEqual(['src/b.ts', 'src/c.ts']);
    expect(hit!.relPath).toBe('src/a.ts');
  });

  it('gc() returns 0 for fresh entries', async () => {
    const cache = await fresh();
    cache.setEdges('h', 'src/x.ts', []);
    expect(cache.gc()).toBe(0);
  });

  it('getStats() reports entries', async () => {
    const cache = await fresh();
    cache.setEdges('h1', 'src/a.ts', []);
    cache.setEdges('h2', 'src/b.ts', []);
    expect(cache.getStats().entries).toBe(2);
  });
});
