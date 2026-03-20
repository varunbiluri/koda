/**
 * GlobalMemoryStore — unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalMemoryStore } from '../../src/intelligence/global-memory-store.js';

// Use a fake rootPath so no disk I/O happens (save() is non-fatal)
const ROOT = '/tmp/koda-test-memory';

describe('GlobalMemoryStore', () => {
  let store: GlobalMemoryStore;

  beforeEach(async () => {
    // Fresh in-memory instance each test
    store = await GlobalMemoryStore.load(ROOT + '-' + Date.now());
  });

  it('starts empty', () => {
    expect(store.taskCount).toBe(0);
    expect(store.averageRetries).toBe(0);
  });

  it('recordTask increments taskCount', () => {
    store.recordTask({ description: 'add auth', succeeded: true, durationMs: 1000, filesChanged: [], retries: 0 });
    expect(store.taskCount).toBe(1);
  });

  it('averageRetries is computed correctly', () => {
    store.recordTask({ description: 't1', succeeded: true,  durationMs: 100, filesChanged: [], retries: 0 });
    store.recordTask({ description: 't2', succeeded: false, durationMs: 200, filesChanged: [], retries: 2 });
    expect(store.averageRetries).toBe(1);
  });

  it('getRelevantTasks returns tasks that match query words', () => {
    store.recordTask({ description: 'fix authentication bug',  succeeded: true,  durationMs: 100, filesChanged: [], retries: 0 });
    store.recordTask({ description: 'add database migration',  succeeded: false, durationMs: 200, filesChanged: [], retries: 0 });
    store.recordTask({ description: 'refactor auth middleware', succeeded: true,  durationMs: 300, filesChanged: [], retries: 0 });

    const hits = store.getRelevantTasks('auth login');
    // Should match "authentication" and "auth middleware" but not "database"
    expect(hits.map((t) => t.description)).not.toContain('add database migration');
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('getContextHint returns empty string when no data', () => {
    expect(store.getContextHint('any query')).toBe('');
  });

  it('getContextHint returns a hint after recording tasks', () => {
    store.recordTask({ description: 'fix auth bug', succeeded: true, durationMs: 100, filesChanged: ['auth.ts'], retries: 0 });
    const hint = store.getContextHint('auth');
    expect(hint).toContain('Memory from past sessions');
    expect(hint).toContain('fix auth bug');
  });

  it('recordFix deduplicates on (failureType, strategy)', () => {
    store.recordFix('compile_error', 'run tsc first', true);
    store.recordFix('compile_error', 'run tsc first', true);
    // Should have only 1 record with count=2
    const best = store.getBestFixStrategy('compile_error');
    expect(best).toBe('run tsc first');
  });

  it('getBestFixStrategy returns null when no data', () => {
    expect(store.getBestFixStrategy('compile_error')).toBeNull();
  });

  it('recordIssue tracks recurring issues', () => {
    store.recordIssue('null pointer dereference');
    store.recordIssue('null pointer dereference');
    const issues = store.getRecurringIssues();
    expect(issues.length).toBe(1);
    expect(issues[0].count).toBe(2);
  });

  it('getRecurringIssues excludes single-occurrence issues', () => {
    store.recordIssue('only happened once');
    expect(store.getRecurringIssues()).toHaveLength(0);
  });
});
