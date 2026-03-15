import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIProvider, ChatCompletionResponse } from '../../src/ai/types.js';
import {
  IterationEngine,
  MAX_ITERATIONS,
  buildFailureContext,
  parsePlan,
} from '../../src/engine/iteration-engine.js';

// Mock ToolRegistry so no real tools run
vi.mock('../../src/tools/tool-registry.js', () => {
  const mockExecute = vi.fn().mockResolvedValue('ok');
  class ToolRegistry {
    execute = mockExecute;
  }
  return { ToolRegistry, _mockExecute: mockExecute };
});

function makeProvider(planJson: string, successOnIteration = 1): AIProvider {
  let calls = 0;
  const response = (): ChatCompletionResponse => {
    calls++;
    return {
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: planJson }, finish_reason: 'stop' }],
    };
  };
  return {
    sendChatCompletion: vi.fn().mockImplementation(async () => response()),
    streamChatCompletion: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
  };
}

const simplePlan = JSON.stringify({
  task: 'Run tests',
  steps: [
    { tool: 'run_terminal', args: { command: 'pnpm test' }, description: 'Run test suite' },
  ],
});

describe('IterationEngine', () => {
  it('succeeds on first iteration when all steps pass', async () => {
    const provider = makeProvider(simplePlan);
    const engine = new IterationEngine(provider, '/repo', { silent: true });

    const summary = await engine.run('run tests');

    expect(summary.success).toBe(true);
    expect(summary.iterations).toBe(1);
    expect(summary.finalPlan).not.toBeNull();
  });

  it('retries up to MAX_ITERATIONS on failure', async () => {
    // Override the shared mock execute to always return an error string
    const mod = await import('../../src/tools/tool-registry.js');
    const registry = new (mod.ToolRegistry as any)('/repo');
    registry.execute.mockResolvedValue('Error: tests failed');

    // Directly patch the module's mock execute for this test
    const { _mockExecute } = mod as any;
    _mockExecute.mockResolvedValue('Error: tests failed');

    const provider = makeProvider(simplePlan);
    const engine = new IterationEngine(provider, '/repo', { silent: true });
    const summary = await engine.run('run tests');

    expect(summary.success).toBe(false);
    expect(summary.iterations).toBe(MAX_ITERATIONS);

    // Restore for subsequent tests
    _mockExecute.mockResolvedValue('ok');
  });

  it('calls provider once per iteration', async () => {
    const provider = makeProvider(simplePlan);
    const engine = new IterationEngine(provider, '/repo', { silent: true });

    await engine.run('task');

    // One plan call per iteration (only 1 iteration needed here since success on first)
    expect(provider.sendChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('exposes MAX_ITERATIONS = 5', () => {
    expect(MAX_ITERATIONS).toBe(5);
  });
});

describe('parsePlan', () => {
  it('parses valid JSON plan', () => {
    const json = JSON.stringify({
      task: 'create auth',
      steps: [{ tool: 'search_code', args: { query: 'auth' }, description: 'search' }],
    });
    const plan = parsePlan(json, 'fallback');
    expect(plan.task).toBe('create auth');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].tool).toBe('search_code');
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n{"task":"t","steps":[]}\n```';
    const plan = parsePlan(fenced, 'fallback');
    expect(plan.task).toBe('t');
  });

  it('returns fallback plan on invalid JSON', () => {
    const plan = parsePlan('not json at all', 'fallback task');
    expect(plan.task).toBe('fallback task');
    expect(plan.steps).toHaveLength(0);
  });

  it('uses fallbackTask when JSON is missing task field', () => {
    const json = JSON.stringify({ steps: [] });
    const plan = parsePlan(json, 'my task');
    expect(plan.task).toBe('my task');
  });
});

describe('buildFailureContext', () => {
  it('includes error summary', () => {
    const ctx = buildFailureContext('TypeError: x is undefined');
    expect(ctx).toContain('TypeError: x is undefined');
    expect(ctx).toContain('Previous step failed');
    expect(ctx).toContain('corrected plan');
  });
});
