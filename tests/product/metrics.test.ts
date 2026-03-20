/**
 * ProductMetrics — unit tests
 */

import { describe, it, expect } from 'vitest';
import { ProductMetrics } from '../../src/product/metrics.js';

async function fresh() {
  return ProductMetrics.load('/tmp/koda-metrics-' + Date.now());
}

describe('ProductMetrics — tracking', () => {
  it('loads cleanly with no prior data', async () => {
    const m = await fresh();
    expect(m.getStore().totalTasks).toBe(0);
    expect(m.getStore().sessionCount).toBe(1);
  });

  it('taskStart/taskComplete increments counters', async () => {
    const m = await fresh();
    m.taskStart('fix', 'null pointer bug');
    m.taskComplete({ success: true, retries: 0 });
    expect(m.getStore().totalTasks).toBe(1);
    expect(m.getStore().successCount).toBe(1);
    expect(m.getStore().failureCount).toBe(0);
  });

  it('tracks failures separately', async () => {
    const m = await fresh();
    m.taskStart('add', 'add feature');
    m.taskComplete({ success: false, retries: 2 });
    expect(m.getStore().failureCount).toBe(1);
    expect(m.getStore().totalRetries).toBe(2);
  });

  it('successRate is 0 when no tasks', async () => {
    const m = await fresh();
    expect(m.successRate()).toBe(0);
  });

  it('successRate is 1.0 for all-success', async () => {
    const m = await fresh();
    m.taskStart('fix', 'bug 1');
    m.taskComplete({ success: true, retries: 0 });
    m.taskStart('fix', 'bug 2');
    m.taskComplete({ success: true, retries: 1 });
    expect(m.successRate()).toBe(1.0);
  });

  it('avgRetries computes correctly', async () => {
    const m = await fresh();
    m.taskStart('fix', 'a');
    m.taskComplete({ success: true, retries: 2 });
    m.taskStart('add', 'b');
    m.taskComplete({ success: true, retries: 0 });
    expect(m.avgRetries()).toBe(1.0);
  });

  it('estimatedHoursSaved increases with successful tasks', async () => {
    const m = await fresh();
    m.taskStart('fix', 'x');
    m.taskComplete({ success: true, retries: 0 });
    expect(m.estimatedHoursSaved()).toBeGreaterThan(0);
  });
});

describe('ProductMetrics — display', () => {
  it('formatOneLiner returns empty string when no tasks', async () => {
    const m = await fresh();
    expect(m.formatOneLiner()).toBe('');
  });

  it('formatOneLiner includes task count and success rate', async () => {
    const m = await fresh();
    m.taskStart('fix', 'bug');
    m.taskComplete({ success: true, retries: 0 });
    const line = m.formatOneLiner();
    expect(line).toContain('1/1');
    expect(line).toContain('100%');
  });

  it('formatSummary returns empty string when no tasks', async () => {
    const m = await fresh();
    expect(m.formatSummary()).toBe('');
  });

  it('formatSummary includes key metrics', async () => {
    const m = await fresh();
    m.taskStart('fix', 'bug');
    m.taskComplete({ success: true, retries: 1, durationMs: 5000 });
    const s = m.formatSummary();
    expect(s).toContain('Tasks:');
    expect(s).toContain('Sessions:');
    expect(s).toContain('Time saved:');
  });
});

describe('ProductMetrics — recentTasks', () => {
  it('stores task records in recentTasks', async () => {
    const m = await fresh();
    m.taskStart('fix', 'described bug');
    m.taskComplete({ success: true, retries: 0 });
    expect(m.getStore().recentTasks).toHaveLength(1);
    expect(m.getStore().recentTasks[0].kind).toBe('fix');
    expect(m.getStore().recentTasks[0].description).toBe('described bug');
  });
});
