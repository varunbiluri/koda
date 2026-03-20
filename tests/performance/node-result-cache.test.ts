/**
 * NodeResultCache — unit tests
 */

import { describe, it, expect } from 'vitest';
import { NodeResultCache } from '../../src/performance/node-result-cache.js';

describe('NodeResultCache.buildKey', () => {
  it('returns a 64-char hex key', async () => {
    const key = await NodeResultCache.buildKey('plan auth', { tool: 'read_file' }, []);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it('different descriptions produce different keys', async () => {
    const k1 = await NodeResultCache.buildKey('task A', {}, []);
    const k2 = await NodeResultCache.buildKey('task B', {}, []);
    expect(k1).not.toBe(k2);
  });

  it('same inputs produce same key', async () => {
    const k1 = await NodeResultCache.buildKey('task X', { a: '1' }, []);
    const k2 = await NodeResultCache.buildKey('task X', { a: '1' }, []);
    expect(k1).toBe(k2);
  });
});

describe('NodeResultCache set/get', () => {
  async function fresh() {
    return NodeResultCache.load('/tmp/koda-nrc-' + Date.now());
  }

  it('returns undefined on miss', async () => {
    const c = await fresh();
    expect(c.get('nosuchkey')).toBeUndefined();
  });

  it('stores and retrieves a result', async () => {
    const c = await fresh();
    const key = await NodeResultCache.buildKey('implement auth', {}, []);
    c.set(key, 'implement auth', 'auth code here');
    const hit = c.get(key);
    expect(hit).toBeDefined();
    expect(hit!.output).toBe('auth code here');
    expect(hit!.nodeDesc).toBe('implement auth');
    expect(hit!.success).toBe(true);
  });

  it('gc returns 0 for fresh entries', async () => {
    const c = await fresh();
    const key = await NodeResultCache.buildKey('test', {}, []);
    c.set(key, 'test', 'output');
    expect(c.gc()).toBe(0);
  });

  it('getStats reports hits and misses', async () => {
    const c = await fresh();
    c.get('miss1');
    c.get('miss2');
    const key = await NodeResultCache.buildKey('node', {}, []);
    c.set(key, 'node', 'out');
    c.get(key);
    const s = c.getStats();
    expect(s.misses).toBe(2);
    expect(s.hits).toBe(1);
    expect(s.hitRate).toBe('33%');
  });
});
