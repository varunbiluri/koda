import { describe, it, expect } from 'vitest';
import { scoreResults } from '../../benchmarks/kcb-10/score.js';
import { loadFixtures, runMockBenchmark } from '../../benchmarks/kcb-10/runner.js';

describe('KCB-10 score', () => {
  it('computes KEI from baseline and median tokens', () => {
    const card = scoreResults(
      [
        {
          taskId: 't1', kind: 'fix', success: true,
          promptTokens: 40_000, completionTokens: 3_000,
          toolCalls: 10, refRate: 0.5, toolResultsTotal: 10, toolResultsViaRef: 5,
        },
        {
          taskId: 't2', kind: 'add', success: true,
          promptTokens: 44_000, completionTokens: 3_500,
          toolCalls: 12, refRate: 0.6, toolResultsTotal: 12, toolResultsViaRef: 7,
        },
      ],
      { version: '0.1.2', baselineMedianTokens: 52_000 },
    );
    expect(card.kei).toBeGreaterThan(0);
    expect(card.taskCount).toBe(2);
    expect(card.successRate).toBe(1);
  });
});

describe('KCB-10 mock runner', () => {
  it('loads 10 fixtures and produces scorecard', async () => {
    const fixtures = await loadFixtures();
    expect(fixtures).toHaveLength(10);
    const card = await runMockBenchmark('0.1.2-test');
    expect(card.taskCount).toBe(10);
    expect(card.medianRefRate).toBeGreaterThan(0);
    expect(card.kei).toBeGreaterThan(0);
  });
});
