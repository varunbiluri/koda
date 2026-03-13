import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExecutionHistoryStore } from '../../../src/memory/history/execution-history-store.js';
import type { ExecutionRecord } from '../../../src/memory/history/types.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('ExecutionHistoryStore', () => {
  let tempDir: string;
  let store: ExecutionHistoryStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'koda-test-history-'));
    store = new ExecutionHistoryStore(tempDir, 100);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const createRecord = (overrides?: Partial<ExecutionRecord>): ExecutionRecord => ({
    id: `test-${Date.now()}-${Math.random()}`,
    timestamp: new Date(),
    task: 'Test task',
    success: true,
    agentsUsed: ['agent-1'],
    filesModified: ['test.ts'],
    errors: [],
    warnings: [],
    verificationAttempts: 1,
    totalTokensUsed: 100,
    duration: 1000,
    ...overrides,
  });

  describe('saveRecord and loadRecords', () => {
    it('should save and load a single record', async () => {
      const record = createRecord();
      await store.saveRecord(record);

      const records = await store.loadRecords();

      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(record.id);
      expect(records[0].task).toBe(record.task);
    });

    it('should preserve timestamp as Date object', async () => {
      const record = createRecord();
      await store.saveRecord(record);

      const records = await store.loadRecords();

      expect(records[0].timestamp).toBeInstanceOf(Date);
    });

    it('should add new records to the beginning', async () => {
      const record1 = createRecord({ id: 'first' });
      const record2 = createRecord({ id: 'second' });

      await store.saveRecord(record1);
      await store.saveRecord(record2);

      const records = await store.loadRecords();

      expect(records[0].id).toBe('second');
      expect(records[1].id).toBe('first');
    });

    it('should limit records to maxRecords', async () => {
      const smallStore = new ExecutionHistoryStore(tempDir, 5);

      for (let i = 0; i < 10; i++) {
        await smallStore.saveRecord(createRecord({ id: `record-${i}` }));
      }

      const records = await smallStore.loadRecords();

      expect(records).toHaveLength(5);
      expect(records[0].id).toBe('record-9'); // Most recent
    });

    it('should use cache on subsequent loads', async () => {
      const record = createRecord();
      await store.saveRecord(record);

      const records1 = await store.loadRecords();
      const records2 = await store.loadRecords();

      expect(records1).toBe(records2); // Same object reference
    });

    it('should handle empty history', async () => {
      const records = await store.loadRecords();
      expect(records).toEqual([]);
    });
  });

  describe('getRecordById', () => {
    it('should find record by id', async () => {
      const record1 = createRecord({ id: 'test-1' });
      const record2 = createRecord({ id: 'test-2' });

      await store.saveRecord(record1);
      await store.saveRecord(record2);

      const found = await store.getRecordById('test-1');

      expect(found).toBeDefined();
      expect(found?.id).toBe('test-1');
    });

    it('should return undefined for non-existent id', async () => {
      const found = await store.getRecordById('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('getRecentRecords', () => {
    it('should return most recent records', async () => {
      for (let i = 0; i < 5; i++) {
        await store.saveRecord(createRecord({ id: `record-${i}` }));
      }

      const recent = await store.getRecentRecords(3);

      expect(recent).toHaveLength(3);
      expect(recent[0].id).toBe('record-4');
      expect(recent[1].id).toBe('record-3');
      expect(recent[2].id).toBe('record-2');
    });

    it('should handle limit larger than available records', async () => {
      await store.saveRecord(createRecord());

      const recent = await store.getRecentRecords(10);

      expect(recent).toHaveLength(1);
    });
  });

  describe('getRecordsByTask', () => {
    it('should filter records by task description', async () => {
      await store.saveRecord(createRecord({ task: 'Fix bug in login' }));
      await store.saveRecord(createRecord({ task: 'Refactor authentication' }));
      await store.saveRecord(createRecord({ task: 'Fix bug in logout' }));

      const bugRecords = await store.getRecordsByTask('bug');

      expect(bugRecords).toHaveLength(2);
    });

    it('should be case-insensitive', async () => {
      await store.saveRecord(createRecord({ task: 'Fix Bug' }));

      const records = await store.getRecordsByTask('bug');

      expect(records).toHaveLength(1);
    });
  });

  describe('getSuccessfulRecords and getFailedRecords', () => {
    it('should filter successful records', async () => {
      await store.saveRecord(createRecord({ success: true }));
      await store.saveRecord(createRecord({ success: false }));
      await store.saveRecord(createRecord({ success: true }));

      const successful = await store.getSuccessfulRecords();

      expect(successful).toHaveLength(2);
      expect(successful.every(r => r.success)).toBe(true);
    });

    it('should filter failed records', async () => {
      await store.saveRecord(createRecord({ success: true }));
      await store.saveRecord(createRecord({ success: false }));
      await store.saveRecord(createRecord({ success: false }));

      const failed = await store.getFailedRecords();

      expect(failed).toHaveLength(2);
      expect(failed.every(r => !r.success)).toBe(true);
    });
  });

  describe('getRecordsByDateRange', () => {
    it('should filter records by date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await store.saveRecord(createRecord({ timestamp: yesterday }));
      await store.saveRecord(createRecord({ timestamp: now }));
      await store.saveRecord(createRecord({ timestamp: tomorrow }));

      const rangeRecords = await store.getRecordsByDateRange(
        new Date(yesterday.getTime() - 1000),
        new Date(now.getTime() + 1000)
      );

      expect(rangeRecords).toHaveLength(2);
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', async () => {
      await store.saveRecord(createRecord({
        success: true,
        duration: 1000,
        totalTokensUsed: 100,
        agentsUsed: ['agent-1', 'agent-2'],
        filesModified: ['file1.ts'],
      }));

      await store.saveRecord(createRecord({
        success: false,
        duration: 2000,
        totalTokensUsed: 200,
        agentsUsed: ['agent-1'],
        filesModified: ['file1.ts', 'file2.ts'],
      }));

      const stats = await store.getStatistics();

      expect(stats.totalExecutions).toBe(2);
      expect(stats.successfulExecutions).toBe(1);
      expect(stats.failedExecutions).toBe(1);
      expect(stats.successRate).toBe(0.5);
      expect(stats.averageDuration).toBe(1500);
      expect(stats.totalTokensUsed).toBe(300);
      expect(stats.mostUsedAgents).toHaveLength(2);
      expect(stats.mostModifiedFiles).toHaveLength(2);
    });

    it('should handle empty history', async () => {
      const stats = await store.getStatistics();

      expect(stats.totalExecutions).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('should sort agents by usage', async () => {
      await store.saveRecord(createRecord({ agentsUsed: ['agent-1'] }));
      await store.saveRecord(createRecord({ agentsUsed: ['agent-2', 'agent-1'] }));
      await store.saveRecord(createRecord({ agentsUsed: ['agent-2'] }));

      const stats = await store.getStatistics();

      expect(stats.mostUsedAgents[0].agent).toBe('agent-2');
      expect(stats.mostUsedAgents[0].count).toBe(2);
      expect(stats.mostUsedAgents[1].agent).toBe('agent-1');
      expect(stats.mostUsedAgents[1].count).toBe(2);
    });
  });

  describe('clearHistory', () => {
    it('should clear all records', async () => {
      await store.saveRecord(createRecord());
      await store.saveRecord(createRecord());

      await store.clearHistory();

      const records = await store.loadRecords();
      expect(records).toEqual([]);
    });

    it('should invalidate cache', async () => {
      await store.saveRecord(createRecord());
      await store.loadRecords(); // Populate cache

      await store.clearHistory();

      const records = await store.loadRecords();
      expect(records).toEqual([]);
    });
  });

  describe('invalidateCache', () => {
    it('should force reload from disk', async () => {
      await store.saveRecord(createRecord({ id: 'first' }));
      await store.loadRecords(); // Cache populated

      // Create new store instance (simulating different process)
      const store2 = new ExecutionHistoryStore(tempDir);
      await store2.saveRecord(createRecord({ id: 'second' }));

      // Original store should still see cached version
      let records = await store.loadRecords();
      expect(records).toHaveLength(1);

      // After invalidation, should see updated data
      store.invalidateCache();
      records = await store.loadRecords();
      expect(records).toHaveLength(2);
    });
  });
});
