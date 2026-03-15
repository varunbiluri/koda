import chalk from 'chalk';
import type { AIProvider, ChatMessage } from '../ai/types.js';
import type { TaskPlan, TaskStep, StepResult, IterationResult } from '../ai/types/task-plan.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { logger } from '../utils/logger.js';
import { saveRunRecord, makeRunId } from '../memory/run-history-store.js';

export const MAX_ITERATIONS = 5;

export interface IterationEngineOptions {
  /** Suppress all console output (useful in tests). */
  silent?: boolean;
}

export interface IterationSummary {
  success: boolean;
  iterations: number;
  finalPlan: TaskPlan | null;
  stepResults: StepResult[];
  commitHash?: string;
}

/**
 * IterationEngine — autonomous Plan → Execute → Verify → Re-plan loop.
 *
 * Flow per iteration:
 *   1. Generate a structured TaskPlan from the AI provider.
 *   2. Execute each step via ToolRegistry.
 *   3. Verify success (check for error signals in step outputs).
 *   4. If failed, pass failure context back to the AI and try again.
 *   5. Stop on first success or after MAX_ITERATIONS.
 */
export class IterationEngine {
  private registry: ToolRegistry;

  constructor(
    private readonly provider: AIProvider,
    private readonly rootPath: string,
    private readonly options: IterationEngineOptions = {},
  ) {
    this.registry = new ToolRegistry(rootPath);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async run(task: string): Promise<IterationSummary> {
    const runId = makeRunId();
    const startedAt = new Date().toISOString();
    let failureContext = '';
    let lastResult: IterationResult | null = null;

    for (let i = 1; i <= MAX_ITERATIONS; i++) {
      this.print(`\n${chalk.bold(`Iteration ${i}`)}`);

      // 1. Generate plan
      const plan = await this.generatePlan(task, failureContext);
      this.print(chalk.gray('  Plan created'));

      // 2. Execute steps
      const stepResults = await this.executeSteps(plan);

      // 3. Verify
      const failed = stepResults.filter((r) => !r.success);
      const success = failed.length === 0;

      lastResult = { iteration: i, plan, stepResults, success };

      if (success) {
        this.print(chalk.green('  ✔ Done'));
        await this.persistRun({
          runId, task, startedAt, success: true, iterations: i, stepCount: stepResults.length,
        });
        return {
          success: true,
          iterations: i,
          finalPlan: plan,
          stepResults,
        };
      }

      // 4. Failure analysis
      const errorSummary = failed
        .map((r) => `Step "${r.step.tool}": ${r.error ?? r.output.slice(0, 200)}`)
        .join('\n');

      this.print(chalk.yellow(`  Tests / steps failed — analyzing errors`));
      logger.debug(`Iteration ${i} failure:\n${errorSummary}`);

      failureContext = buildFailureContext(errorSummary);
    }

    await this.persistRun({
      runId, task, startedAt, success: false,
      iterations: MAX_ITERATIONS,
      stepCount: lastResult?.stepResults.length ?? 0,
    });
    return {
      success: false,
      iterations: MAX_ITERATIONS,
      finalPlan: lastResult?.plan ?? null,
      stepResults: lastResult?.stepResults ?? [],
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async generatePlan(task: string, failureContext: string): Promise<TaskPlan> {
    const systemPrompt = [
      'You are Koda, an AI software engineer.',
      'Respond ONLY with a valid JSON object matching this schema:',
      '{ "task": string, "steps": [ { "tool": string, "args": object, "description": string } ] }',
      '',
      'Available tools: read_file, write_file, apply_patch, search_code, list_files,',
      '  git_branch, git_status, git_diff, git_log, run_terminal, koda_commit,',
      '  git_push, git_create_pr, fetch_url',
      '',
      'Rules:',
      '• Each step must use one of the available tools.',
      '• "args" must match the tool parameters exactly.',
      '• Do not include explanations outside the JSON.',
    ].join('\n');

    const userMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: failureContext
          ? `${failureContext}\n\nOriginal task: ${task}`
          : `Task: ${task}`,
      },
    ];

    try {
      const response = await this.provider.sendChatCompletion({
        messages: userMessages,
        temperature: 0.2,
        max_tokens: 1000,
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      return parsePlan(raw, task);
    } catch (err) {
      logger.warn(`Plan generation failed: ${(err as Error).message}`);
      return { task, steps: [] };
    }
  }

  private async executeSteps(plan: TaskPlan): Promise<StepResult[]> {
    const results: StepResult[] = [];

    for (const step of plan.steps) {
      this.print(chalk.gray(`  ⚙  ${step.description ?? step.tool}`));

      try {
        const output = await this.registry.execute(step.tool, step.args);
        const success = !isErrorOutput(output);
        results.push({ step, output, success, error: success ? undefined : output });
      } catch (err) {
        const error = (err as Error).message;
        results.push({ step, output: '', success: false, error });
      }
    }

    return results;
  }

  private print(msg: string): void {
    if (!this.options.silent) process.stdout.write(msg + '\n');
  }

  private async persistRun(opts: {
    runId: string;
    task: string;
    startedAt: string;
    success: boolean;
    iterations: number;
    stepCount: number;
  }): Promise<void> {
    try {
      await saveRunRecord(
        {
          runId: opts.runId,
          task: opts.task,
          startedAt: opts.startedAt,
          finishedAt: new Date().toISOString(),
          success: opts.success,
          iterations: opts.iterations,
          stepCount: opts.stepCount,
        },
        this.rootPath,
      );
    } catch {
      // History write failures are non-fatal
    }
  }
}

// ── Module-level helpers ───────────────────────────────────────────────────

/** Build the failure context injected into the next planning prompt. */
export function buildFailureContext(errorSummary: string): string {
  return [
    'Previous step failed.',
    '',
    'Error:',
    errorSummary,
    '',
    'Generate a corrected plan that fixes the above errors.',
  ].join('\n');
}

/** Parse AI response into a TaskPlan, with a safe fallback. */
export function parsePlan(raw: string, fallbackTask: string): TaskPlan {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    const obj = JSON.parse(cleaned) as { task?: string; steps?: TaskStep[] };
    return {
      task: typeof obj.task === 'string' ? obj.task : fallbackTask,
      steps: Array.isArray(obj.steps) ? obj.steps : [],
    };
  } catch {
    logger.warn('Could not parse structured plan from AI response');
    return { task: fallbackTask, steps: [] };
  }
}

/** Heuristic: treat tool output starting with "Error:" as a failure. */
function isErrorOutput(output: string): boolean {
  return output.trimStart().startsWith('Error:');
}
