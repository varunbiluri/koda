/**
 * ASTGraphCache — unit tests
 */

import { describe, it, expect } from 'vitest';
import { ASTGraphCache } from '../../src/performance/ast-graph-cache.js';

describe('ASTGraphCache.hashContent', () => {
  it('returns a 64-char hex string', () => {
    const h = ASTGraphCache.hashContent('hello world');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    const h1 = ASTGraphCache.hashContent('same content');
    const h2 = ASTGraphCache.hashContent('same content');
    expect(h1).toBe(h2);
  });

  it('differs for different content', () => {
    expect(ASTGraphCache.hashContent('a')).not.toBe(ASTGraphCache.hashContent('b'));
  });
});

describe('ASTGraphCache.load (fresh)', () => {
  it('returns a cache instance for a non-existent path', async () => {
    const cache = await ASTGraphCache.load('/tmp/koda-test-nonexistent-' + Date.now());
    expect(cache).toBeDefined();
  });

  it('get() returns undefined on empty cache', async () => {
    const cache = await ASTGraphCache.load('/tmp/koda-test-' + Date.now());
    expect(cache.get('nonexistent-hash')).toBeUndefined();
  });
});

describe('ASTGraphCache set/get', () => {
  it('stores and retrieves a result by hash', async () => {
    const cache = await ASTGraphCache.load('/tmp/koda-test-' + Date.now());
    const hash  = 'abc123';
    cache.set(hash, 'src/auth.ts', {
      imports: ['./utils'],
      symbols: [{ name: 'AuthService', kind: 'class', startLine: 1, endLine: 50 }],
    });
    const hit = cache.get(hash);
    expect(hit).toBeDefined();
    expect(hit!.imports).toEqual(['./utils']);
    expect(hit!.symbols[0].name).toBe('AuthService');
    expect(hit!.relPath).toBe('src/auth.ts');
    expect(hit!.cachedAt).toBeGreaterThan(0);
  });

  it('get() returns undefined for a different hash', async () => {
    const cache = await ASTGraphCache.load('/tmp/koda-test-' + Date.now());
    cache.set('hash-a', 'src/a.ts', { imports: [], symbols: [] });
    expect(cache.get('hash-b')).toBeUndefined();
  });
});

describe('ASTGraphCache.gc', () => {
  it('returns 0 when nothing to evict', async () => {
    const cache = await ASTGraphCache.load('/tmp/koda-test-' + Date.now());
    cache.set('h1', 'src/a.ts', { imports: [], symbols: [] });
    expect(cache.gc()).toBe(0);
  });
});

describe('ASTGraphCache.getStats', () => {
  it('reports entry count', async () => {
    const cache = await ASTGraphCache.load('/tmp/koda-test-' + Date.now());
    cache.set('h1', 'src/a.ts', { imports: [], symbols: [] });
    cache.set('h2', 'src/b.ts', { imports: [], symbols: [] });
    expect(cache.getStats().entries).toBe(2);
  });
});
