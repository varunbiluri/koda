/**
 * Telemetry — unit tests
 */

import { describe, it, expect } from 'vitest';
import { Telemetry } from '../../src/performance/telemetry.js';

describe('Telemetry (enabled)', () => {
  it('tracks node start/end', () => {
    const t = new Telemetry({ enabled: true });
    t.nodeStart('node1');
    t.nodeEnd('node1', { success: true });
    const r = t.getReport();
    expect(r.nodeTimings).toHaveLength(1);
    expect(r.nodeTimings[0].nodeId).toBe('node1');
    expect(r.nodeTimings[0].success).toBe(true);
    expect(r.nodeTimings[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('tracks tool calls', () => {
    const t = new Telemetry({ enabled: true });
    t.toolCall('read_file', 'src/auth.ts', 42);
    t.toolCall('grep_code', 'TODO', 18);
    const r = t.getReport();
    expect(r.toolTimings).toHaveLength(2);
    expect(r.totalToolMs).toBe(60);
  });

  it('tracks LLM calls', () => {
    const t = new Telemetry({ enabled: true });
    t.nodeStart('plan');
    t.llmCall(300, 1200);
    t.nodeEnd('plan', { success: true });
    const r = t.getReport();
    expect(r.llmTimings).toHaveLength(1);
    expect(r.totalLLMMs).toBe(1200);
  });

  it('identifies slowest node', () => {
    const t = new Telemetry({ enabled: true });
    t.nodeStart('fast');
    t.nodeEnd('fast', { success: true });
    t.nodeStart('slow');
    t.toolCall('read_file', 'big.ts', 500);
    t.nodeEnd('slow', { success: true });
    const r = t.getReport();
    // slowestNode has longest durationMs — just check it exists
    expect(r.slowestNode).not.toBeNull();
  });

  it('tracks retries', () => {
    const t = new Telemetry({ enabled: true });
    t.nodeStart('flaky');
    t.nodeRetry('flaky');
    t.nodeRetry('flaky');
    t.nodeEnd('flaky', { success: true, retries: 2 });
    const r = t.getReport();
    expect(r.nodeTimings[0].retries).toBe(2);
  });

  it('formatReport returns non-empty string', () => {
    const t = new Telemetry({ enabled: true });
    t.nodeStart('n1');
    t.nodeEnd('n1', { success: true });
    expect(t.formatReport()).toContain('Performance Report');
  });
});

describe('Telemetry (disabled)', () => {
  it('formatReport returns empty string', () => {
    const t = new Telemetry({ enabled: false });
    t.nodeStart('n1');
    t.nodeEnd('n1', { success: true });
    expect(t.formatReport()).toBe('');
  });

  it('getReport returns empty arrays', () => {
    const t = new Telemetry({ enabled: false });
    t.nodeStart('n1');
    t.nodeEnd('n1', { success: true });
    const r = t.getReport();
    expect(r.nodeTimings).toHaveLength(0);
  });
});
