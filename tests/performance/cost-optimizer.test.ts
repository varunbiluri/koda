/**
 * CostOptimizer — unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CostOptimizer } from '../../src/performance/cost-optimizer.js';

describe('CostOptimizer.shouldCallLLM', () => {
  let opt: CostOptimizer;
  beforeEach(() => { opt = new CostOptimizer(); });

  it('returns true for ANALYSIS node type', () => {
    expect(opt.shouldCallLLM('ANALYSIS', 'implement authentication')).toBe(true);
  });

  it('returns true for IMPLEMENTATION node type', () => {
    expect(opt.shouldCallLLM('IMPLEMENTATION', 'write the auth service')).toBe(true);
  });

  it('returns false for LISTING node type', () => {
    expect(opt.shouldCallLLM('LISTING', 'list all files')).toBe(false);
  });

  it('returns false for STATUS node type', () => {
    expect(opt.shouldCallLLM('STATUS', 'show git status')).toBe(false);
  });

  it('returns false for deterministic task description — list files', () => {
    expect(opt.shouldCallLLM('GENERAL', 'list files in src/')).toBe(false);
  });

  it('returns false for deterministic task — check node version', () => {
    expect(opt.shouldCallLLM('GENERAL', 'check node version')).toBe(false);
  });

  it('increments skipped count when returning false', () => {
    opt.shouldCallLLM('LISTING', 'list files');
    opt.shouldCallLLM('LISTING', 'list directories');
    expect(opt.getRecord().skipped).toBe(2);
  });
});

describe('CostOptimizer.recordUsage', () => {
  let opt: CostOptimizer;
  beforeEach(() => { opt = new CostOptimizer(); });

  it('accumulates token counts', () => {
    opt.recordUsage(1000, 500);
    opt.recordUsage(2000, 800);
    const r = opt.getRecord();
    expect(r.promptTokens).toBe(3000);
    expect(r.completionTokens).toBe(1300);
    expect(r.calls).toBe(2);
  });

  it('estimates a non-zero cost for real usage', () => {
    opt.recordUsage(10_000, 5_000);
    expect(opt.getRecord().estimatedCentUSD).toBeGreaterThan(0);
  });

  it('formatSummary includes call count', () => {
    opt.recordUsage(100, 50);
    expect(opt.formatSummary()).toContain('1 LLM calls');
  });
});

describe('CostOptimizer.reset', () => {
  it('clears all counters', () => {
    const opt = new CostOptimizer();
    opt.recordUsage(1000, 500);
    opt.reset();
    const r = opt.getRecord();
    expect(r.calls).toBe(0);
    expect(r.promptTokens).toBe(0);
  });
});
