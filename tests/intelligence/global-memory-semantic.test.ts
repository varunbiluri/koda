/**
 * GlobalMemoryStore — semantic patterns tests
 */

import { describe, it, expect } from 'vitest';
import { GlobalMemoryStore } from '../../src/intelligence/global-memory-store.js';

const ROOT = '/tmp/koda-test-semantic';

describe('GlobalMemoryStore — semantic patterns', () => {
  async function fresh() {
    return GlobalMemoryStore.load(ROOT + '-' + Date.now());
  }

  it('recordSemanticPattern stores a new pattern', async () => {
    const store = await fresh();
    store.recordSemanticPattern(
      'null pointer in auth',
      'token not validated before access',
      'add guard: if (!token) return 401',
      'JWT tokens may be absent if header missing',
      'null_access → missing_guard',
    );
    const patterns = store.getRelevantSemanticPatterns('auth null');
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].pattern).toBe('null_access → missing_guard');
  });

  it('recordSemanticPattern increments occurrences on duplicate pattern', async () => {
    const store = await fresh();
    store.recordSemanticPattern('null err', 'missing check', 'add guard', 'always guard', 'null → guard');
    store.recordSemanticPattern('null error again', 'missing check', 'add guard', 'always guard', 'null → guard');
    const patterns = store.getRelevantSemanticPatterns('null');
    expect(patterns[0].occurrences).toBe(2);
  });

  it('getContextHint includes semantic patterns section', async () => {
    const store = await fresh();
    store.recordSemanticPattern(
      'auth fails',
      'missing token validation',
      'add token guard',
      'JWT tokens need validation',
      'missing_validation → auth_failure',
    );
    const hint = store.getContextHint('auth token');
    expect(hint).toContain('Known patterns');
    expect(hint).toContain('missing_validation → auth_failure');
  });

  it('getRelevantSemanticPatterns returns empty when no patterns', async () => {
    const store = await fresh();
    expect(store.getRelevantSemanticPatterns('anything')).toHaveLength(0);
  });

  it('getRelevantSemanticPatterns ranks by relevance + occurrences', async () => {
    const store = await fresh();
    store.recordSemanticPattern('auth null pointer', 'cause1', 'fix1', 'reason1', 'p1');
    store.recordSemanticPattern('auth null pointer', 'cause2', 'fix2', 'reason2', 'p1'); // bump to 2 occurrences
    store.recordSemanticPattern('database connection', 'cause3', 'fix3', 'reason3', 'p2');
    const results = store.getRelevantSemanticPatterns('auth null');
    // auth-related pattern should rank higher
    expect(results[0].pattern).toBe('p1');
  });
});
