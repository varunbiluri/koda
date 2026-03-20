/**
 * LearningLoop — unit tests
 */

import { describe, it, expect } from 'vitest';
import { LearningLoop } from '../../src/intelligence/learning-loop.js';

const ROOT = '/tmp/koda-test-learning';

describe('LearningLoop', () => {
  async function fresh() {
    return LearningLoop.load(ROOT + '-' + Date.now());
  }

  it('starts with no observations', async () => {
    const loop = await fresh();
    expect(loop.getStats().totalObservations).toBe(0);
  });

  it('recordOutcome increments wins', async () => {
    const loop = await fresh();
    loop.recordOutcome('compile_error', 'run tsc first', true);
    loop.recordOutcome('compile_error', 'run tsc first', true);
    const records = loop.getStrategies('compile_error');
    expect(records[0].wins).toBe(2);
    expect(records[0].losses).toBe(0);
    expect(records[0].winRate).toBe(1.0);
  });

  it('recordOutcome increments losses', async () => {
    const loop = await fresh();
    loop.recordOutcome('test_failure', 'fix test assertions', false);
    const records = loop.getStrategies('test_failure');
    expect(records[0].losses).toBe(1);
    expect(records[0].winRate).toBe(0);
  });

  it('getBestStrategy returns null when fewer than 2 observations', async () => {
    const loop = await fresh();
    loop.recordOutcome('compile_error', 'run tsc first', true);
    // Only 1 observation — not enough to trust
    expect(loop.getBestStrategy('compile_error')).toBeNull();
  });

  it('getBestStrategy returns the strategy with highest win rate after 2+ observations', async () => {
    const loop = await fresh();
    loop.recordOutcome('compile_error', 'run tsc first', true);
    loop.recordOutcome('compile_error', 'run tsc first', true);
    loop.recordOutcome('compile_error', 'guess and check', false);
    loop.recordOutcome('compile_error', 'guess and check', false);
    expect(loop.getBestStrategy('compile_error')).toBe('run tsc first');
  });

  it('getBestStrategy returns null for unknown failure type', async () => {
    const loop = await fresh();
    expect(loop.getBestStrategy('unknown_type')).toBeNull();
  });

  it('formatHint returns empty string when no data', async () => {
    const loop = await fresh();
    expect(loop.formatHint('compile_error')).toBe('');
  });

  it('formatHint returns a hint with win rate after sufficient data', async () => {
    const loop = await fresh();
    loop.recordOutcome('test_failure', 'read test file first', true);
    loop.recordOutcome('test_failure', 'read test file first', true);
    const hint = loop.formatHint('test_failure');
    expect(hint).toContain('100%');
    expect(hint).toContain('read test file first');
  });

  it('getStats reflects total observations', async () => {
    const loop = await fresh();
    loop.recordOutcome('compile_error', 's1', true);
    loop.recordOutcome('test_failure',  's2', false);
    loop.recordOutcome('test_failure',  's2', true);
    const { totalObservations, failureTypesLearned } = loop.getStats();
    expect(totalObservations).toBe(3);
    expect(failureTypesLearned).toBe(2);
  });
});
