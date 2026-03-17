import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionTracker } from '../../../src/observability/execution-tracker.js';
import { EventLogger } from '../../../src/observability/event-logger.js';

describe('ExecutionTracker', () => {
  let tracker: ExecutionTracker;
  let mockLogger: EventLogger;

  beforeEach(() => {
    mockLogger = new EventLogger();
    tracker = new ExecutionTracker(mockLogger);
  });

  describe('start and finish', () => {
    it('should track execution duration', async () => {
      tracker.start();

      await new Promise(resolve => setTimeout(resolve, 50));

      const metrics = tracker.finish();

      expect(metrics.totalDuration).toBeGreaterThan(0);
    });

    it('should reset metrics on start', () => {
      tracker.start();
      tracker.recordAgentCompletion('agent-1', true);

      tracker.start(); // Reset

      const metrics = tracker.getMetrics();

      expect(metrics.totalAgents).toBe(0);
    });
  });

  describe('recordAgentCompletion', () => {
    it('should track successful agents', () => {
      tracker.start();
      tracker.recordAgentCompletion('agent-1', true);
      tracker.recordAgentCompletion('agent-2', true);

      const metrics = tracker.getMetrics();

      expect(metrics.totalAgents).toBe(2);
      expect(metrics.successfulAgents).toBe(2);
      expect(metrics.failedAgents).toBe(0);
    });

    it('should track failed agents', () => {
      tracker.start();
      tracker.recordAgentCompletion('agent-1', true);
      tracker.recordAgentCompletion('agent-2', false);

      const metrics = tracker.getMetrics();

      expect(metrics.totalAgents).toBe(2);
      expect(metrics.successfulAgents).toBe(1);
      expect(metrics.failedAgents).toBe(1);
    });

    it('should store agent results', () => {
      tracker.start();
      tracker.recordAgentCompletion('agent-1', true);
      tracker.recordAgentCompletion('agent-2', false);

      const results = tracker.getAgentResults();

      expect(results.get('agent-1')).toBe(true);
      expect(results.get('agent-2')).toBe(false);
    });
  });

  describe('recordFileModification', () => {
    it('should track unique modified files', () => {
      tracker.start();
      tracker.recordFileModification('file1.ts');
      tracker.recordFileModification('file2.ts');
      tracker.recordFileModification('file1.ts'); // Duplicate

      const metrics = tracker.getMetrics();

      expect(metrics.filesModified).toBe(2);
    });

    it('should return list of modified files', () => {
      tracker.start();
      tracker.recordFileModification('file1.ts');
      tracker.recordFileModification('file2.ts');

      const files = tracker.getModifiedFiles();

      expect(files).toContain('file1.ts');
      expect(files).toContain('file2.ts');
    });
  });

  describe('recordIteration', () => {
    it('should track iteration count', () => {
      tracker.start();
      tracker.recordIteration(1, false);
      tracker.recordIteration(2, false);
      tracker.recordIteration(3, true);

      const metrics = tracker.getMetrics();

      expect(metrics.iterations).toBe(3);
    });

    it('should use max iteration number', () => {
      tracker.start();
      tracker.recordIteration(5, true);
      tracker.recordIteration(3, false); // Out of order

      const metrics = tracker.getMetrics();

      expect(metrics.iterations).toBe(5);
    });
  });

  describe('recordTokenUsage', () => {
    it('should accumulate token usage', () => {
      tracker.start();
      tracker.recordTokenUsage(100);
      tracker.recordTokenUsage(250);
      tracker.recordTokenUsage(150);

      const metrics = tracker.getMetrics();

      expect(metrics.tokenUsage).toBe(500);
    });
  });

  describe('recordTestExecution', () => {
    it('should count test runs', () => {
      tracker.start();
      tracker.recordTestExecution();
      tracker.recordTestExecution();
      tracker.recordTestExecution();

      const metrics = tracker.getMetrics();

      expect(metrics.testsRun).toBe(3);
    });
  });

  describe('getSuccessRate', () => {
    it('should calculate correct success rate', () => {
      tracker.start();
      tracker.recordAgentCompletion('agent-1', true);
      tracker.recordAgentCompletion('agent-2', true);
      tracker.recordAgentCompletion('agent-3', false);
      tracker.recordAgentCompletion('agent-4', true);

      const rate = tracker.getSuccessRate();

      expect(rate).toBe(0.75); // 3/4
    });

    it('should return 0 with no agents', () => {
      tracker.start();

      const rate = tracker.getSuccessRate();

      expect(rate).toBe(0);
    });
  });

  describe('formatSummary', () => {
    it('should format readable summary', () => {
      tracker.start();
      tracker.recordAgentCompletion('agent-1', true);
      tracker.recordAgentCompletion('agent-2', false);
      tracker.recordFileModification('test.ts');
      tracker.recordTokenUsage(1000);
      tracker.recordTestExecution();
      tracker.recordIteration(2, true);

      const summary = tracker.formatSummary();

      expect(summary).toContain('Execution Summary');
      expect(summary).toContain('Total: 2');
      expect(summary).toContain('Successful: 1');
      expect(summary).toContain('Failed: 1');
      expect(summary).toContain('Files Modified: 1');
      expect(summary).toContain('Tests Run: 1');
      expect(summary).toContain('Token Usage: 1,000');
    });
  });

  describe('formatDetailedReport', () => {
    it('should include agent results and modified files', () => {
      tracker.start();
      tracker.recordAgentCompletion('agent-1', true);
      tracker.recordAgentCompletion('agent-2', false);
      tracker.recordFileModification('file1.ts');
      tracker.recordFileModification('file2.ts');

      const report = tracker.formatDetailedReport();

      expect(report).toContain('Agent Results');
      expect(report).toContain('agent-1');
      expect(report).toContain('agent-2');
      expect(report).toContain('Modified Files');
      expect(report).toContain('file1.ts');
      expect(report).toContain('file2.ts');
    });
  });

  describe('reset', () => {
    it('should reset all tracking data', () => {
      tracker.start();
      tracker.recordAgentCompletion('agent-1', true);
      tracker.recordFileModification('test.ts');
      tracker.recordTokenUsage(1000);

      tracker.reset();

      const metrics = tracker.getMetrics();
      const agentResults = tracker.getAgentResults();
      const files = tracker.getModifiedFiles();

      expect(metrics.totalAgents).toBe(0);
      expect(metrics.tokenUsage).toBe(0);
      expect(agentResults.size).toBe(0);
      expect(files).toEqual([]);
    });
  });

  describe('event logging integration', () => {
    it('should log events through event logger', () => {
      tracker.start();
      tracker.recordAgentStart('agent-1');
      tracker.recordAgentCompletion('agent-1', true);

      const events = mockLogger.getEvents();

      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.type === 'agent_started')).toBe(true);
      expect(events.some(e => e.type === 'agent_finished')).toBe(true);
    });

    it('should log verification events', () => {
      tracker.start();
      tracker.recordVerificationStart();
      tracker.recordVerificationResult(true);
      tracker.recordVerificationResult(false, ['Type error']);

      const events = mockLogger.getEvents();

      expect(events.some(e => e.type === 'verification_started')).toBe(true);
      expect(events.some(e => e.type === 'verification_passed')).toBe(true);
      expect(events.some(e => e.type === 'verification_failed')).toBe(true);
    });

    it('should log tool calls', () => {
      tracker.start();
      tracker.recordToolCall('read_file', 'agent-1', { path: 'test.ts' });

      const events = mockLogger.getEvents();

      expect(events.some(e => e.type === 'tool_called')).toBe(true);
    });

    it('should log budget exceeded', () => {
      tracker.start();
      tracker.recordBudgetExceeded('expensive-agent', { tokens: 50000 });

      const events = mockLogger.getEvents();

      expect(events.some(e => e.type === 'budget_exceeded')).toBe(true);
    });

    it('should log lock events', () => {
      tracker.start();
      tracker.recordLockAcquired('test.ts', 'agent-1');
      tracker.recordLockReleased('test.ts', 'agent-1');

      const events = mockLogger.getEvents();

      expect(events.some(e => e.type === 'lock_acquired')).toBe(true);
      expect(events.some(e => e.type === 'lock_released')).toBe(true);
    });
  });

  describe('getMetrics', () => {
    it('should return current metrics without finishing', async () => {
      tracker.start();

      await new Promise(resolve => setTimeout(resolve, 10));

      tracker.recordAgentCompletion('agent-1', true);

      const metrics = tracker.getMetrics();

      expect(metrics.totalAgents).toBe(1);
      expect(metrics.totalDuration).toBeGreaterThan(0);
    });

    it('should update duration in real-time', async () => {
      tracker.start();

      const metrics1 = tracker.getMetrics();

      await new Promise(resolve => setTimeout(resolve, 50));

      const metrics2 = tracker.getMetrics();

      expect(metrics2.totalDuration).toBeGreaterThan(metrics1.totalDuration);
    });
  });
});
