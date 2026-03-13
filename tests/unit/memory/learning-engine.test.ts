import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LearningEngine } from '../../../src/memory/history/learning-engine.js';
import { ExecutionHistoryStore } from '../../../src/memory/history/execution-history-store.js';
import type { ExecutionRecord } from '../../../src/memory/history/types.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('LearningEngine', () => {
  let tempDir: string;
  let store: ExecutionHistoryStore;
  let engine: LearningEngine;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'koda-test-learning-'));
    store = new ExecutionHistoryStore(tempDir, 100);
    engine = new LearningEngine(store);
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

  describe('analyzePatterns', () => {
    it('should return empty array with insufficient data', async () => {
      await store.saveRecord(createRecord());

      const patterns = await engine.analyzePatterns();

      expect(patterns).toEqual([]);
    });

    it('should identify patterns from similar tasks', async () => {
      // Add multiple fix tasks
      for (let i = 0; i < 5; i++) {
        await store.saveRecord(createRecord({
          task: `Fix bug in module ${i}`,
          success: true,
          agentsUsed: ['bug-fixer', 'test-runner'],
        }));
      }

      const patterns = await engine.analyzePatterns();

      expect(patterns.length).toBeGreaterThan(0);
      const fixPattern = patterns.find(p => p.taskType === 'fix');
      expect(fixPattern).toBeDefined();
      expect(fixPattern?.successRate).toBe(1);
      expect(fixPattern?.successfulAgents).toContain('bug-fixer');
    });

    it('should calculate correct success rates', async () => {
      // 3 successful, 2 failed refactor tasks
      for (let i = 0; i < 3; i++) {
        await store.saveRecord(createRecord({
          task: 'Refactor code',
          success: true,
        }));
      }

      for (let i = 0; i < 2; i++) {
        await store.saveRecord(createRecord({
          task: 'Refactor code',
          success: false,
        }));
      }

      const patterns = await engine.analyzePatterns();

      const refactorPattern = patterns.find(p => p.taskType === 'refactor');
      expect(refactorPattern?.successRate).toBe(0.6); // 3/5
    });

    it('should identify common errors', async () => {
      const commonError = 'Type error in authentication module';

      for (let i = 0; i < 4; i++) {
        await store.saveRecord(createRecord({
          task: 'Fix bug',
          success: false,
          errors: [commonError],
        }));
      }

      const patterns = await engine.analyzePatterns();

      const fixPattern = patterns.find(p => p.taskType === 'fix');
      expect(fixPattern?.commonErrors.length).toBeGreaterThan(0);
    });

    it('should calculate average verification attempts', async () => {
      await store.saveRecord(createRecord({ task: 'Build project', verificationAttempts: 2 }));
      await store.saveRecord(createRecord({ task: 'Build project', verificationAttempts: 4 }));
      await store.saveRecord(createRecord({ task: 'Build project', verificationAttempts: 3 }));

      const patterns = await engine.analyzePatterns();

      const buildPattern = patterns.find(p => p.taskType === 'build');
      expect(buildPattern?.averageAttempts).toBe(3); // (2+4+3)/3
    });
  });

  describe('generateInsights', () => {
    it('should generate insights from patterns', async () => {
      // Create a successful pattern
      for (let i = 0; i < 5; i++) {
        await store.saveRecord(createRecord({
          task: 'Fix bug',
          success: true,
          agentsUsed: ['debugger', 'test-runner'],
        }));
      }

      const insights = await engine.generateInsights();

      expect(insights.length).toBeGreaterThan(0);
      expect(insights[0].confidence).toBeGreaterThan(0);
    });

    it('should identify high-performing agent combinations', async () => {
      const agentCombo = ['architect', 'implementer', 'tester'];

      for (let i = 0; i < 5; i++) {
        await store.saveRecord(createRecord({
          success: true,
          agentsUsed: agentCombo,
        }));
      }

      const insights = await engine.generateInsights();

      const comboInsight = insights.find(i => i.pattern.includes('Agent combination'));
      expect(comboInsight).toBeDefined();
    });

    it('should identify common failure patterns', async () => {
      const commonError = 'Module not found';

      for (let i = 0; i < 5; i++) {
        await store.saveRecord(createRecord({
          success: false,
          errors: [commonError],
        }));
      }

      const insights = await engine.generateInsights();

      const errorInsight = insights.find(i => i.pattern.includes('Common error'));
      expect(errorInsight).toBeDefined();
    });

    it('should flag high verification attempt counts', async () => {
      for (let i = 0; i < 3; i++) {
        await store.saveRecord(createRecord({
          task: 'Optimize code',
          verificationAttempts: 5,
        }));
      }

      const insights = await engine.generateInsights();

      const verificationInsight = insights.find(i => i.pattern.includes('High verification attempts'));
      expect(verificationInsight).toBeDefined();
    });

    it('should identify high-risk files', async () => {
      const riskyFile = 'auth.ts';

      // 6 modifications, 4 failures
      for (let i = 0; i < 4; i++) {
        await store.saveRecord(createRecord({
          success: false,
          filesModified: [riskyFile],
        }));
      }

      for (let i = 0; i < 2; i++) {
        await store.saveRecord(createRecord({
          success: true,
          filesModified: [riskyFile],
        }));
      }

      const insights = await engine.generateInsights();

      const fileInsight = insights.find(i => i.pattern.includes('High-risk file'));
      expect(fileInsight).toBeDefined();
    });

    it('should sort insights by confidence', async () => {
      // Create diverse patterns
      for (let i = 0; i < 10; i++) {
        await store.saveRecord(createRecord({
          task: 'Fix bug',
          success: true,
          agentsUsed: ['debugger'],
        }));
      }

      const insights = await engine.generateInsights();

      if (insights.length > 1) {
        for (let i = 0; i < insights.length - 1; i++) {
          expect(insights[i].confidence).toBeGreaterThanOrEqual(insights[i + 1].confidence);
        }
      }
    });
  });

  describe('getSuggestedAgents', () => {
    it('should suggest agents based on historical success', async () => {
      // Create pattern: fix tasks succeed with debugger + tester
      for (let i = 0; i < 5; i++) {
        await store.saveRecord(createRecord({
          task: 'Fix authentication bug',
          success: true,
          agentsUsed: ['debugger', 'tester'],
        }));
      }

      const suggested = await engine.getSuggestedAgents('Fix login bug');

      expect(suggested).toContain('debugger');
      expect(suggested).toContain('tester');
    });

    it('should return empty array with no matching patterns', async () => {
      await store.saveRecord(createRecord({ task: 'Build project' }));
      await store.saveRecord(createRecord({ task: 'Build project' }));

      const suggested = await engine.getSuggestedAgents('Completely unrelated task');

      expect(suggested).toEqual([]);
    });

    it('should prefer highest success rate pattern', async () => {
      // Pattern 1: fix with debugger (60% success)
      for (let i = 0; i < 3; i++) {
        await store.saveRecord(createRecord({
          task: 'Fix bug',
          success: true,
          agentsUsed: ['debugger'],
        }));
      }
      for (let i = 0; i < 2; i++) {
        await store.saveRecord(createRecord({
          task: 'Fix bug',
          success: false,
          agentsUsed: ['debugger'],
        }));
      }

      // Pattern 2: fix with analyzer (100% success)
      for (let i = 0; i < 3; i++) {
        await store.saveRecord(createRecord({
          task: 'Fix bug',
          success: true,
          agentsUsed: ['analyzer'],
        }));
      }

      const suggested = await engine.getSuggestedAgents('Fix another bug');

      expect(suggested[0]).toBe('analyzer'); // Should prefer 100% success rate
    });
  });

  describe('getCommonPitfalls', () => {
    it('should return common errors for task type', async () => {
      const commonError = 'Build failed: missing dependency';

      for (let i = 0; i < 3; i++) {
        await store.saveRecord(createRecord({
          task: 'Build project',
          errors: [commonError],
        }));
      }

      const pitfalls = await engine.getCommonPitfalls('build');

      expect(pitfalls.length).toBeGreaterThan(0);
    });

    it('should return empty array for unknown task type', async () => {
      const pitfalls = await engine.getCommonPitfalls('unknown-task-type');

      expect(pitfalls).toEqual([]);
    });
  });

  describe('task type extraction', () => {
    it('should correctly categorize task types', async () => {
      const tasks = [
        { description: 'Fix authentication bug', expectedType: 'fix' },
        { description: 'Refactor user service', expectedType: 'refactor' },
        { description: 'Build project', expectedType: 'build' },
        { description: 'Run tests', expectedType: 'test' },
        { description: 'Implement new feature', expectedType: 'implement' },
        { description: 'Update dependencies', expectedType: 'update' },
        { description: 'Optimize query performance', expectedType: 'optimize' },
      ];

      for (const { description } of tasks) {
        for (let i = 0; i < 3; i++) {
          await store.saveRecord(createRecord({ task: description }));
        }
      }

      const patterns = await engine.analyzePatterns();

      expect(patterns.some(p => p.taskType === 'fix')).toBe(true);
      expect(patterns.some(p => p.taskType === 'refactor')).toBe(true);
      expect(patterns.some(p => p.taskType === 'build')).toBe(true);
    });
  });
});
