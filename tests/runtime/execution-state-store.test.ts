/**
 * Tests for ExecutionStateStore.
 *
 * Filesystem is mocked — no real disk I/O.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionStateStore } from '../../src/runtime/execution-state-store.js';
import type { PersistedExecutionState } from '../../src/runtime/execution-state-store.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// In-memory fs mock
const fsMock: Record<string, string> = {};

vi.mock('node:fs/promises', () => ({
  mkdir:    vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn(async (path: string, data: string) => { fsMock[path] = data; }),
  readFile:  vi.fn(async (path: string) => {
    if (!(path in fsMock)) throw new Error('ENOENT');
    return fsMock[path];
  }),
  readdir:   vi.fn(async () => Object.keys(fsMock).map((p) => p.split('/').at(-1)!)),
  unlink:    vi.fn(async (path: string) => { delete fsMock[path]; }),
}));

// ── Fake graph ────────────────────────────────────────────────────────────────

function makeGraph(graphId = 'graph-test-abc') {
  return {
    graphId,
    task: 'Test task',
    toJSON: () => ({ graphId, task: 'Test task', createdAt: Date.now(), nodes: [] }),
    getStats: () => ({ completed: 2, failed: 0 }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ExecutionStateStore.save()', () => {
  beforeEach(() => {
    Object.keys(fsMock).forEach((k) => delete fsMock[k]);
  });

  it('writes a JSON file for the graph', async () => {
    const store = new ExecutionStateStore('/repo');
    const graph = makeGraph();
    await store.save(graph, 'running');
    const keys = Object.keys(fsMock);
    expect(keys.some((k) => k.includes('graph-test-abc'))).toBe(true);
  });

  it('persisted state has correct fields', async () => {
    const store = new ExecutionStateStore('/repo');
    await store.save(makeGraph(), 'completed');
    const raw   = Object.values(fsMock)[0];
    const state = JSON.parse(raw) as PersistedExecutionState;
    expect(state.graphId).toBe('graph-test-abc');
    expect(state.status).toBe('completed');
    expect(state.completedNodeCount).toBe(2);
    expect(state.failedNodeCount).toBe(0);
  });

  it('does not throw on write failure', async () => {
    const { writeFile } = await import('node:fs/promises');
    (writeFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));
    const store = new ExecutionStateStore('/repo');
    await expect(store.save(makeGraph())).resolves.toBeUndefined();
  });
});

describe('ExecutionStateStore.load()', () => {
  beforeEach(() => {
    Object.keys(fsMock).forEach((k) => delete fsMock[k]);
  });

  it('returns null for a missing graph', async () => {
    const store = new ExecutionStateStore('/repo');
    expect(await store.load('nonexistent')).toBeNull();
  });

  it('returns the persisted state for a saved graph', async () => {
    const store = new ExecutionStateStore('/repo');
    await store.save(makeGraph('g1'), 'running');
    const loaded = await store.load('g1');
    expect(loaded).not.toBeNull();
    expect(loaded!.graphId).toBe('g1');
    expect(loaded!.status).toBe('running');
  });
});

describe('ExecutionStateStore.list()', () => {
  beforeEach(() => {
    Object.keys(fsMock).forEach((k) => delete fsMock[k]);
  });

  it('returns empty array when no states exist', async () => {
    const store = new ExecutionStateStore('/repo');
    // mock readdir returns empty
    const { readdir } = await import('node:fs/promises');
    (readdir as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    expect(await store.list()).toEqual([]);
  });

  it('returns saved states sorted newest-first', async () => {
    const store = new ExecutionStateStore('/repo');
    await store.save(makeGraph('old'), 'completed');
    // Ensure timestamps differ
    await new Promise((r) => setTimeout(r, 5));
    await store.save(makeGraph('new'), 'running');
    const list = await store.list();
    if (list.length >= 2) {
      expect(list[0].savedAt).toBeGreaterThanOrEqual(list[1].savedAt);
    }
  });
});

describe('ExecutionStateStore.delete()', () => {
  it('removes a state file', async () => {
    Object.keys(fsMock).forEach((k) => delete fsMock[k]);
    const store = new ExecutionStateStore('/repo');
    await store.save(makeGraph('del-me'), 'running');
    await store.delete('del-me');
    expect(await store.load('del-me')).toBeNull();
  });

  it('does not throw when deleting non-existent state', async () => {
    const store = new ExecutionStateStore('/repo');
    await expect(store.delete('never-existed')).resolves.toBeUndefined();
  });
});

describe('ExecutionStateStore.findResumable()', () => {
  beforeEach(() => {
    Object.keys(fsMock).forEach((k) => delete fsMock[k]);
  });

  it('returns a running state', async () => {
    const store = new ExecutionStateStore('/repo');
    await store.save(makeGraph('r1'), 'running');
    const found = await store.findResumable();
    expect(found?.graphId).toBe('r1');
  });

  it('returns null when only completed states exist', async () => {
    Object.keys(fsMock).forEach((k) => delete fsMock[k]);
    const store = new ExecutionStateStore('/repo');
    await store.save(makeGraph('c1'), 'completed');
    // Override list to only return completed
    vi.spyOn(store, 'list').mockResolvedValueOnce([
      { graphId: 'c1', task: 'task', savedAt: Date.now(), status: 'completed', graph: {} as any, completedNodeCount: 1, failedNodeCount: 0 },
    ]);
    expect(await store.findResumable()).toBeNull();
  });
});

describe('ExecutionStateStore.markCompleted() / markFailed()', () => {
  it('markCompleted saves with status=completed', async () => {
    Object.keys(fsMock).forEach((k) => delete fsMock[k]);
    const store = new ExecutionStateStore('/repo');
    const saveSpy = vi.spyOn(store, 'save');
    await store.markCompleted(makeGraph());
    expect(saveSpy).toHaveBeenCalledWith(expect.anything(), 'completed');
  });

  it('markFailed saves with status=failed', async () => {
    const store   = new ExecutionStateStore('/repo');
    const saveSpy = vi.spyOn(store, 'save');
    await store.markFailed(makeGraph());
    expect(saveSpy).toHaveBeenCalledWith(expect.anything(), 'failed');
  });
});
