import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { saveRunRecord, loadRunHistory, makeRunId } from '../../src/memory/run-history-store.js';
import type { RunRecord } from '../../src/memory/run-history-store.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-history-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'test-run-1',
    task: 'run tests',
    startedAt: '2026-03-15T10:00:00.000Z',
    finishedAt: '2026-03-15T10:00:05.000Z',
    success: true,
    iterations: 1,
    stepCount: 3,
    ...overrides,
  };
}

describe('run history persistence', () => {
  it('saves and reloads a run record', async () => {
    const record = makeRecord();
    await saveRunRecord(record, tmpDir);

    const loaded = await loadRunHistory(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].runId).toBe('test-run-1');
    expect(loaded[0].task).toBe('run tests');
    expect(loaded[0].success).toBe(true);
  });

  it('record file is written to .koda/history/', async () => {
    await saveRunRecord(makeRecord({ runId: 'r-123' }), tmpDir);
    const stat = await fs.stat(path.join(tmpDir, '.koda', 'history', 'run-r-123.json'));
    expect(stat.isFile()).toBe(true);
  });

  it('loadRunHistory returns empty array for new directory', async () => {
    const result = await loadRunHistory(tmpDir);
    expect(result).toEqual([]);
  });

  it('records are sorted oldest-first by runId filename', async () => {
    await saveRunRecord(makeRecord({ runId: 'aaa', task: 'first' }), tmpDir);
    await saveRunRecord(makeRecord({ runId: 'zzz', task: 'last' }), tmpDir);
    await saveRunRecord(makeRecord({ runId: 'mmm', task: 'middle' }), tmpDir);

    const loaded = await loadRunHistory(tmpDir);
    expect(loaded[0].task).toBe('first');
    expect(loaded[1].task).toBe('middle');
    expect(loaded[2].task).toBe('last');
  });

  it('persists all fields correctly', async () => {
    const record: RunRecord = {
      runId: 'full-test',
      task: 'implement auth',
      startedAt: '2026-03-15T09:00:00.000Z',
      finishedAt: '2026-03-15T09:00:30.000Z',
      success: false,
      iterations: 5,
      stepCount: 12,
    };
    await saveRunRecord(record, tmpDir);
    const [loaded] = await loadRunHistory(tmpDir);
    expect(loaded).toEqual(record);
  });

  it('multiple records can be stored and retrieved', async () => {
    for (let i = 0; i < 3; i++) {
      await saveRunRecord(makeRecord({ runId: `run-${i}`, task: `task ${i}` }), tmpDir);
    }
    const loaded = await loadRunHistory(tmpDir);
    expect(loaded).toHaveLength(3);
  });
});

describe('makeRunId', () => {
  it('returns a non-empty string', () => {
    expect(makeRunId().length).toBeGreaterThan(0);
  });

  it('is safe for use as a filename (no colons or dots)', () => {
    const id = makeRunId();
    expect(id).not.toContain(':');
    expect(id).not.toContain('.');
  });

  it('two consecutive IDs differ', async () => {
    const a = makeRunId();
    await new Promise((r) => setTimeout(r, 2));
    const b = makeRunId();
    expect(a).not.toBe(b);
  });
});
