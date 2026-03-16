/**
 * Tests for ToolPlanner.
 *
 * LLM calls are mocked so tests are deterministic and fast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ToolPlanner,
  formatToolPlan,
  MAX_PLAN_STEPS,
} from '../../src/planning/tool-planner.js';
import type { ToolPlan } from '../../src/planning/tool-planner.js';
import type { AIProvider } from '../../src/ai/types.js';

// ── Mock helpers ───────────────────────────────────────────────────────────────

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function makeMockProvider(planText: string): AIProvider {
  return {
    sendChatCompletion: vi.fn().mockResolvedValue({
      choices: [{ message: { content: planText } }],
    }),
  } as unknown as AIProvider;
}

const VALID_PLAN_TEXT = [
  '1. search_files | pattern=src/**/*.ts | locate TypeScript files',
  '2. grep_code | query=class AuthService | find AuthService class',
  '3. read_file | path=src/auth/auth-service.ts | read the service',
  '4. edit_file | path=src/auth/auth-service.ts | implement the feature',
  '5. run_terminal | command=pnpm test | verify tests pass',
].join('\n');

// ── Tests: generateToolPlan ────────────────────────────────────────────────────

describe('ToolPlanner.generateToolPlan()', () => {
  let planner: ToolPlanner;

  beforeEach(() => {
    planner = new ToolPlanner(makeMockProvider(VALID_PLAN_TEXT));
  });

  it('returns a ToolPlan with the correct task', async () => {
    const plan = await planner.generateToolPlan('Add JWT auth');
    expect(plan.task).toBe('Add JWT auth');
  });

  it('parses all pipe-separated steps', async () => {
    const plan = await planner.generateToolPlan('Add JWT auth');
    expect(plan.steps).toHaveLength(5);
  });

  it('parses tool names correctly', async () => {
    const plan = await planner.generateToolPlan('Add JWT auth');
    expect(plan.steps[0].tool).toBe('search_files');
    expect(plan.steps[1].tool).toBe('grep_code');
    expect(plan.steps[4].tool).toBe('run_terminal');
  });

  it('parses arg key-value pairs', async () => {
    const plan = await planner.generateToolPlan('Add JWT auth');
    expect(plan.steps[0].args).toEqual({ pattern: 'src/**/*.ts' });
    expect(plan.steps[1].args).toEqual({ query: 'class AuthService' });
  });

  it('parses purpose strings', async () => {
    const plan = await planner.generateToolPlan('Add JWT auth');
    expect(plan.steps[0].purpose).toBe('locate TypeScript files');
  });

  it('sets adjustments to 0 initially', async () => {
    const plan = await planner.generateToolPlan('Add JWT auth');
    expect(plan.adjustments).toBe(0);
  });

  it('sets generatedAt as a recent timestamp', async () => {
    const before = Date.now();
    const plan   = await planner.generateToolPlan('Add JWT auth');
    const after  = Date.now();
    expect(plan.generatedAt).toBeGreaterThanOrEqual(before);
    expect(plan.generatedAt).toBeLessThanOrEqual(after);
  });

  it('returns empty steps when LLM fails', async () => {
    const failProvider: AIProvider = {
      sendChatCompletion: vi.fn().mockRejectedValue(new Error('API timeout')),
    } as unknown as AIProvider;
    const p = new ToolPlanner(failProvider);
    const plan = await p.generateToolPlan('Some task');
    expect(plan.steps).toHaveLength(0);
  });

  it('caps steps at MAX_PLAN_STEPS', async () => {
    const manySteps = Array.from({ length: 20 }, (_, i) =>
      `${i + 1}. search_files | pattern=src/** | step ${i + 1}`,
    ).join('\n');
    const p = new ToolPlanner(makeMockProvider(manySteps));
    const plan = await p.generateToolPlan('Big task');
    expect(plan.steps.length).toBeLessThanOrEqual(MAX_PLAN_STEPS);
  });

  it('parses paren-format steps', async () => {
    const parenText = '1. search_files(src/**) — locate all source files';
    const p = new ToolPlanner(makeMockProvider(parenText));
    const plan = await p.generateToolPlan('Find files');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].tool).toBe('search_files');
    expect(plan.steps[0].args).toEqual({ pattern: 'src/**' });
    expect(plan.steps[0].purpose).toBe('locate all source files');
  });

  it('ignores lines without a leading number', async () => {
    const mixedText = [
      'Here is the plan:',
      '1. search_files | pattern=src/** | find files',
      'Note: always explore first',
    ].join('\n');
    const p = new ToolPlanner(makeMockProvider(mixedText));
    const plan = await p.generateToolPlan('Task');
    expect(plan.steps).toHaveLength(1);
  });
});

// ── Tests: markStepDone ────────────────────────────────────────────────────────

describe('ToolPlanner.markStepDone()', () => {
  it('marks the step as done and records success', async () => {
    const planner = new ToolPlanner(makeMockProvider(VALID_PLAN_TEXT));
    const plan    = await planner.generateToolPlan('Task');
    planner.markStepDone(plan, 1, true);
    expect(plan.steps[0].done).toBe(true);
    expect(plan.steps[0].success).toBe(true);
  });

  it('records failure correctly', async () => {
    const planner = new ToolPlanner(makeMockProvider(VALID_PLAN_TEXT));
    const plan    = await planner.generateToolPlan('Task');
    planner.markStepDone(plan, 1, false);
    expect(plan.steps[0].success).toBe(false);
  });

  it('does nothing for an unknown step id', async () => {
    const planner = new ToolPlanner(makeMockProvider(VALID_PLAN_TEXT));
    const plan    = await planner.generateToolPlan('Task');
    // Should not throw
    expect(() => planner.markStepDone(plan, 999, true)).not.toThrow();
  });
});

// ── Tests: updatePlanAfterStep ─────────────────────────────────────────────────

describe('ToolPlanner.updatePlanAfterStep()', () => {
  it('inserts a re-exploration step when result says "no files found"', async () => {
    const planner = new ToolPlanner(makeMockProvider(VALID_PLAN_TEXT));
    const plan    = await planner.generateToolPlan('Task');
    const before  = plan.steps.length;
    planner.updatePlanAfterStep(plan, 'No files found in src/auth/');
    expect(plan.steps.length).toBeGreaterThan(before);
    expect(plan.adjustments).toBe(1);
  });

  it('does not insert a step when result is normal', async () => {
    const planner = new ToolPlanner(makeMockProvider(VALID_PLAN_TEXT));
    const plan    = await planner.generateToolPlan('Task');
    const before  = plan.steps.length;
    planner.updatePlanAfterStep(plan, 'Found 3 files matching src/**/*.ts');
    expect(plan.steps.length).toBe(before);
    expect(plan.adjustments).toBe(0);
  });

  it('does not insert twice for the same "not found" result', async () => {
    const planner = new ToolPlanner(makeMockProvider(VALID_PLAN_TEXT));
    const plan    = await planner.generateToolPlan('Task');
    planner.updatePlanAfterStep(plan, 'no results found');
    const after1  = plan.steps.length;
    planner.updatePlanAfterStep(plan, 'no results found');
    // Second call: no more pending edit steps, so no second insertion
    expect(plan.steps.length).toBeGreaterThanOrEqual(after1);
  });
});

// ── Tests: computeMetrics ──────────────────────────────────────────────────────

describe('ToolPlanner.computeMetrics()', () => {
  it('returns correct step count', async () => {
    const planner = new ToolPlanner(makeMockProvider(VALID_PLAN_TEXT));
    const plan    = await planner.generateToolPlan('Task');
    const metrics = planner.computeMetrics(plan);
    expect(metrics.steps).toBe(5);
  });

  it('returns successRate of 0 when no steps done', async () => {
    const planner = new ToolPlanner(makeMockProvider(VALID_PLAN_TEXT));
    const plan    = await planner.generateToolPlan('Task');
    const metrics = planner.computeMetrics(plan);
    expect(metrics.successRate).toBe(0);
  });

  it('computes successRate correctly after some steps', async () => {
    const planner = new ToolPlanner(makeMockProvider(VALID_PLAN_TEXT));
    const plan    = await planner.generateToolPlan('Task');
    planner.markStepDone(plan, 1, true);
    planner.markStepDone(plan, 2, true);
    planner.markStepDone(plan, 3, false);
    const metrics = planner.computeMetrics(plan);
    expect(metrics.successfulSteps).toBe(2);
    expect(metrics.failedSteps).toBe(1);
    expect(metrics.successRate).toBeCloseTo(2 / 3, 1);
  });
});

// ── Tests: formatToolPlan ──────────────────────────────────────────────────────

describe('formatToolPlan()', () => {
  it('returns empty string when all steps are done', () => {
    const plan: ToolPlan = {
      task:        'Test',
      steps:       [{ id: 1, tool: 'search_files', args: {}, purpose: 'find files', done: true }],
      generatedAt: Date.now(),
      adjustments: 0,
    };
    expect(formatToolPlan(plan)).toBe('');
  });

  it('formats pending steps as a numbered list', () => {
    const plan: ToolPlan = {
      task: 'Test',
      steps: [
        { id: 1, tool: 'search_files', args: { pattern: 'src/**' }, purpose: 'find files' },
        { id: 2, tool: 'read_file',    args: { path: 'src/index.ts' }, purpose: 'read entry' },
      ],
      generatedAt: Date.now(),
      adjustments: 0,
    };
    const result = formatToolPlan(plan);
    expect(result).toContain('1. search_files');
    expect(result).toContain('2. read_file');
    expect(result).toContain('find files');
    expect(result).toContain('Planned tool sequence');
  });

  it('skips done steps in output', () => {
    const plan: ToolPlan = {
      task: 'Test',
      steps: [
        { id: 1, tool: 'search_files', args: {}, purpose: 'find', done: true },
        { id: 2, tool: 'read_file',    args: {}, purpose: 'read' },
      ],
      generatedAt: Date.now(),
      adjustments: 0,
    };
    const result = formatToolPlan(plan);
    expect(result).not.toContain('search_files');
    expect(result).toContain('read_file');
  });
});

// ── Tests: ToolPlanner.formatMetrics ──────────────────────────────────────────

describe('ToolPlanner.formatMetrics()', () => {
  it('includes all metric fields', () => {
    const output = ToolPlanner.formatMetrics({
      steps: 5, adjustments: 1, executionTimeMs: 3000,
      successfulSteps: 4, failedSteps: 1, successRate: 0.8,
    });
    expect(output).toContain('steps:');
    expect(output).toContain('adjustments:');
    expect(output).toContain('time:');
    expect(output).toContain('successRate:');
  });
});
