/**
 * PersistentToolCache — unit tests
 */

import { describe, it, expect } from 'vitest';
import { PersistentToolCache } from '../../src/performance/persistent-tool-cache.js';

describe('PersistentToolCache', () => {
  async function fresh() {
    return PersistentToolCache.load('/tmp/koda-ptc-' + Date.now());
  }

  it('returns undefined for uncacheable tool (write_file)', async () => {
    const c = await fresh();
    const r = await c.get('write_file', { path: 'src/a.ts' });
    expect(r).toBeUndefined();
  });

  it('returns undefined on cache miss', async () => {
    const c = await fresh();
    const r = await c.get('read_file', { path: 'src/nonexistent.ts' });
    expect(r).toBeUndefined();
  });

  it('stores and retrieves a read_file result', async () => {
    const c = await fresh();
    await c.set('read_file', { path: 'src/auth.ts' }, undefined, 'file content here');
    const r = await c.get('read_file', { path: 'src/auth.ts' });
    expect(r).toBe('file content here');
  });

  it('does not store write_file results', async () => {
    const c = await fresh();
    await c.set('write_file', { path: 'src/auth.ts' }, undefined, 'content');
    const r = await c.get('write_file', { path: 'src/auth.ts' });
    expect(r).toBeUndefined();
  });

  it('different args produce different cache entries', async () => {
    const c = await fresh();
    await c.set('read_file', { path: 'src/a.ts' }, undefined, 'content A');
    await c.set('read_file', { path: 'src/b.ts' }, undefined, 'content B');
    expect(await c.get('read_file', { path: 'src/a.ts' })).toBe('content A');
    expect(await c.get('read_file', { path: 'src/b.ts' })).toBe('content B');
  });

  it('getStats reports hits and misses', async () => {
    const c = await fresh();
    await c.get('read_file', { path: 'src/miss.ts' }); // miss
    await c.set('read_file', { path: 'src/hit.ts' }, undefined, 'data');
    await c.get('read_file', { path: 'src/hit.ts' }); // hit
    const s = c.getStats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
  });

  it('gc evicts nothing for fresh entries', async () => {
    const c = await fresh();
    await c.set('grep_code', { pattern: 'TODO' }, undefined, 'results');
    expect(c.gc()).toBe(0);
  });
});
