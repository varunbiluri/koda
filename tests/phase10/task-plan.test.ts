import { describe, it, expect } from 'vitest';
import type { TaskPlan, TaskStep, StepResult, IterationResult } from '../../src/ai/types/task-plan.js';

describe('TaskPlan types', () => {
  it('TaskPlan holds task and steps', () => {
    const plan: TaskPlan = {
      task: 'Add login endpoint',
      steps: [
        { tool: 'search_code', args: { query: 'auth controller' } },
        { tool: 'apply_patch', args: { filePath: 'auth.ts', startLine: 10, endLine: 20, replacement: 'new code' } },
        { tool: 'run_terminal', args: { command: 'npm test' } },
      ],
    };
    expect(plan.task).toBe('Add login endpoint');
    expect(plan.steps).toHaveLength(3);
  });

  it('TaskStep holds tool and args', () => {
    const step: TaskStep = { tool: 'read_file', args: { path: 'src/app.ts' }, description: 'Read app' };
    expect(step.tool).toBe('read_file');
    expect(step.args['path']).toBe('src/app.ts');
    expect(step.description).toBe('Read app');
  });

  it('TaskStep description is optional', () => {
    const step: TaskStep = { tool: 'git_status', args: {} };
    expect(step.description).toBeUndefined();
  });

  it('StepResult captures success and output', () => {
    const step: TaskStep = { tool: 'run_terminal', args: { command: 'pnpm test' } };
    const result: StepResult = { step, output: 'Tests passed', success: true };
    expect(result.success).toBe(true);
    expect(result.output).toBe('Tests passed');
    expect(result.error).toBeUndefined();
  });

  it('StepResult can capture failure with error', () => {
    const step: TaskStep = { tool: 'run_terminal', args: { command: 'pnpm test' } };
    const result: StepResult = {
      step,
      output: 'Error: tests failed',
      success: false,
      error: 'TypeError: x is undefined',
    };
    expect(result.success).toBe(false);
    expect(result.error).toContain('TypeError');
  });

  it('IterationResult captures iteration number and plan', () => {
    const plan: TaskPlan = { task: 'fix bug', steps: [] };
    const iter: IterationResult = {
      iteration: 2,
      plan,
      stepResults: [],
      success: false,
      failureReason: 'Tests still failing',
    };
    expect(iter.iteration).toBe(2);
    expect(iter.failureReason).toBe('Tests still failing');
  });
});
