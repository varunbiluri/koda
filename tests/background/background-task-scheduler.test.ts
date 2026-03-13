import { describe, it, expect } from 'vitest';
import { BackgroundTaskScheduler } from '../../src/background/background-task-scheduler.js';

describe('BackgroundTaskScheduler', () => {
  it('enqueues a task and emits task-started', () => {
    const scheduler = new BackgroundTaskScheduler(2);
    const started: string[] = [];
    scheduler.on('task-started', (task) => started.push(task.agentType));

    scheduler.enqueue({ agentType: 'security-scan-agent', filePath: 'src/foo.ts', priority: 5 });

    expect(started).toHaveLength(1);
    expect(started[0]).toBe('security-scan-agent');
  });

  it('deduplicates tasks with same agentType+filePath', () => {
    const scheduler = new BackgroundTaskScheduler(5);
    const started: string[] = [];
    scheduler.on('task-started', (task) => started.push(task.id));

    scheduler.enqueue({ agentType: 'security-scan-agent', filePath: 'src/foo.ts', priority: 5 });
    const second = scheduler.enqueue({ agentType: 'security-scan-agent', filePath: 'src/foo.ts', priority: 5 });

    expect(second).toBe(false);
    expect(started).toHaveLength(1);
  });

  it('respects concurrency limit', () => {
    const scheduler = new BackgroundTaskScheduler(2);
    const started: string[] = [];
    scheduler.on('task-started', (task) => started.push(task.id));

    // Enqueue 5 tasks — only 2 should start immediately (concurrency=2)
    for (let i = 0; i < 5; i++) {
      scheduler.enqueue({ agentType: `agent-${i}`, filePath: `src/file-${i}.ts`, priority: 1 });
    }

    // First 2 start immediately
    expect(started).toHaveLength(2);
    expect(scheduler.queueLength).toBe(3);
  });

  it('drains queue as tasks complete', () => {
    const scheduler = new BackgroundTaskScheduler(1);
    const started: string[] = [];
    scheduler.on('task-started', (task) => started.push(task.id));

    scheduler.enqueue({ agentType: 'agent-a', filePath: 'src/a.ts', priority: 1 });
    scheduler.enqueue({ agentType: 'agent-b', filePath: 'src/b.ts', priority: 1 });

    expect(started).toHaveLength(1); // concurrency=1, only one starts

    const firstTaskId = started[0];
    scheduler.taskCompleted(firstTaskId);

    expect(started).toHaveLength(2); // second task now starts
  });

  it('emits task-completed and task-failed events', () => {
    const scheduler = new BackgroundTaskScheduler(2);
    const completed: string[] = [];
    const failed: string[] = [];

    scheduler.on('task-completed', (id) => completed.push(id));
    scheduler.on('task-failed', (info) => failed.push(info.taskId));

    scheduler.enqueue({ agentType: 'agent-a', filePath: 'src/a.ts', priority: 1 });
    scheduler.enqueue({ agentType: 'agent-b', filePath: 'src/b.ts', priority: 1 });

    scheduler.taskCompleted('some-id');
    scheduler.taskFailed('other-id', 'timeout');

    expect(completed).toContain('some-id');
    expect(failed).toContain('other-id');
  });

  it('sorts queue by priority (higher priority first)', () => {
    const scheduler = new BackgroundTaskScheduler(1);
    const started: Array<{ agentType: string; priority: number }> = [];
    scheduler.on('task-started', (task) => started.push({ agentType: task.agentType, priority: task.priority }));

    // First task starts immediately (fills concurrency slot)
    scheduler.enqueue({ agentType: 'low', filePath: 'src/low.ts', priority: 1 });

    // Queue two more — high priority should go first
    scheduler.enqueue({ agentType: 'medium', filePath: 'src/medium.ts', priority: 5 });
    scheduler.enqueue({ agentType: 'high', filePath: 'src/high.ts', priority: 10 });

    // Complete first task to drain queue
    scheduler.taskCompleted(started[0].agentType + ':src/low.ts');

    // High priority should be next
    expect(started[1].agentType).toBe('high');
  });
});
