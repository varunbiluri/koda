/**
 * ToolPlanner — generates a structured, ordered tool execution plan before
 * the reasoning loop begins.
 *
 * Instead of reactive tool usage (LLM decides each tool call on the fly),
 * the planner emits a complete sequence upfront:
 *
 *   Plan:
 *   1. search_files("auth/**") — locate authentication files
 *   2. grep_code("jwt")        — find token handling logic
 *   3. read_file(auth.ts)      — understand existing middleware
 *   4. edit_file(auth.ts)      — implement feature
 *   5. run_terminal("pnpm t")  — verify tests pass
 *
 * This reduces tool misuse, clarifies intent, and makes recovery easier.
 *
 * The plan is injected into the ReasoningEngine step prompt as context.
 * After each step the planner can update the remaining plan based on results.
 */

import type { AIProvider } from '../ai/types.js';
import { logger } from '../utils/logger.js';

// ── Constants ──────────────────────────────────────────────────────────────────

export const MAX_PLAN_STEPS = 12;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ToolPlanStep {
  id:      number;
  tool:    string;
  /** Tool arguments as key→value pairs. */
  args:    Record<string, string>;
  /** Short description of why this tool is called. */
  purpose: string;
  /** Set to true once the step has been executed. */
  done?:   boolean;
  /** True if the step succeeded, false if it errored. */
  success?: boolean;
}

export interface ToolPlan {
  task:        string;
  steps:       ToolPlanStep[];
  generatedAt: number;
  /** Number of times the plan has been adjusted mid-execution. */
  adjustments: number;
}

export interface PlanMetrics {
  steps:           number;
  adjustments:     number;
  executionTimeMs: number;
  successfulSteps: number;
  failedSteps:     number;
  successRate:     number;   // 0–1
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Parse a single plan line into a ToolPlanStep.
 *
 * Expected format (flexible):
 *   "1. search_files | pattern="src/**" | locate source files"
 *   "1. search_files(src/**) — locate source files"
 *   "1. search_files "src/**" - locate source files"
 */
function parsePlanLine(raw: string, fallbackId: number): ToolPlanStep | null {
  const line = raw.trim();

  // Require a leading number
  const numMatch = line.match(/^(\d+)[.):\s]+(.+)/);
  if (!numMatch) return null;

  const id      = parseInt(numMatch[1], 10);
  const rest    = numMatch[2].trim();

  if (id < 1 || id > MAX_PLAN_STEPS) return null;

  // Extract tool name (first word or first word before | or ( )
  const toolMatch = rest.match(/^(\w+)/);
  if (!toolMatch) return null;

  const tool    = toolMatch[1].toLowerCase();
  const args:   Record<string, string> = {};
  let purpose   = '';

  // Try pipe-separated format: tool | key=value | purpose
  const pipeParts = rest.split('|').map((p) => p.trim());
  if (pipeParts.length >= 3) {
    // pipeParts[1] may be "pattern=..." or just the arg value
    const argStr = pipeParts[1];
    const kv = argStr.match(/^(\w+)\s*=\s*["']?([^"']+)["']?$/);
    if (kv) {
      args[kv[1]] = kv[2].trim();
    } else {
      args[inferArgKey(tool)] = argStr.replace(/^["']|["']$/g, '');
    }
    purpose = pipeParts[2];
  } else {
    // Try parenthesis format: tool(arg) — purpose
    const parenMatch = rest.match(/^\w+\s*\(([^)]*)\)\s*[-—]\s*(.+)/);
    if (parenMatch) {
      args[inferArgKey(tool)] = parenMatch[1].replace(/^["']|["']$/g, '');
      purpose = parenMatch[2].trim();
    } else {
      // Fallback: treat the remainder after the tool name as purpose
      purpose = rest.slice(tool.length).replace(/^[\s\-—]+/, '').trim();
    }
  }

  return { id: id || fallbackId, tool, args, purpose: purpose || `Execute ${tool}` };
}

/** Return the canonical argument key name for common tools. */
function inferArgKey(tool: string): string {
  switch (tool) {
    case 'search_files': return 'pattern';
    case 'grep_code':    return 'query';
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'list_directory': return 'path';
    case 'run_terminal':   return 'command';
    default:               return 'value';
  }
}

/** Format a ToolPlan as a compact, human-readable string for prompt injection. */
export function formatToolPlan(plan: ToolPlan): string {
  const pending = plan.steps.filter((s) => !s.done);
  if (pending.length === 0) return '';

  const lines = pending.map(
    (s) => {
      const argStr = Object.entries(s.args)
        .map(([k, v]) => `${k}="${v}"`)
        .join(', ');
      return `${s.id}. ${s.tool}(${argStr}) — ${s.purpose}`;
    },
  );

  return [
    '## Planned tool sequence (execute in order):',
    ...lines,
    '',
    'Follow this plan. Adjust only if a step reveals new information that changes the approach.',
  ].join('\n');
}

// ── ToolPlanner ────────────────────────────────────────────────────────────────

/**
 * Generates and maintains a structured tool execution plan for a given task.
 *
 * Usage:
 * ```ts
 * const planner = new ToolPlanner(provider);
 * const plan = await planner.generateToolPlan(task, repositoryContext);
 * // Inject formatToolPlan(plan) into the step prompt
 * // After each step:
 * planner.markStepDone(plan, stepId, success);
 * planner.updatePlanAfterStep(plan, stepResult);
 * ```
 */
export class ToolPlanner {
  private planStartTime = 0;
  private stepResults: Array<{ stepId: number; success: boolean }> = [];

  constructor(private readonly provider: AIProvider) {}

  // ── Plan generation ────────────────────────────────────────────────────────

  /**
   * Generate a structured tool plan for the given task.
   *
   * Uses a single LLM call at temperature 0.1 to produce a deterministic sequence.
   *
   * @param task     - Task description.
   * @param repoCtx  - Optional repository context (file list, architecture notes).
   */
  async generateToolPlan(task: string, repoCtx = ''): Promise<ToolPlan> {
    this.planStartTime = Date.now();
    this.stepResults   = [];

    const systemPrompt = [
      'You are a tool sequencer for an AI software engineer.',
      'Your job is to produce a numbered list of tool calls to accomplish a task.',
      '',
      'Available tools: search_files, grep_code, read_file, list_directory,',
      'write_file, edit_file, run_terminal, git_status, git_diff.',
      '',
      'Rules:',
      `- Output EXACTLY ${MAX_PLAN_STEPS} or fewer steps`,
      '- Each line: "N. tool_name | arg_key=arg_value | short purpose"',
      '- Start with exploration (search_files, grep_code) before editing',
      '- End with verification (run_terminal) when appropriate',
      '- No explanations, preamble, or markdown — just the numbered list',
    ].join('\n');

    const contextBlock = repoCtx ? `\nRepository context:\n${repoCtx.slice(0, 2000)}\n` : '';
    const userPrompt   = `${contextBlock}\nTask: ${task}\n\nGenerate the tool plan:`;

    let planText = '';

    try {
      const response = await this.provider.sendChatCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens:  400,
      });
      planText = response.choices[0]?.message?.content ?? '';
    } catch (err) {
      logger.warn(`[tool-planner] LLM call failed — returning empty plan: ${(err as Error).message}`);
      return { task, steps: [], generatedAt: Date.now(), adjustments: 0 };
    }

    const steps: ToolPlanStep[] = [];
    let fallbackId = 1;

    for (const line of planText.split('\n')) {
      if (steps.length >= MAX_PLAN_STEPS) break;
      const step = parsePlanLine(line, fallbackId);
      if (step) {
        steps.push(step);
        fallbackId = step.id + 1;
      }
    }

    logger.debug(`[tool-planner] Generated ${steps.length}-step plan for: ${task.slice(0, 60)}`);

    return { task, steps, generatedAt: Date.now(), adjustments: 0 };
  }

  // ── Plan maintenance ────────────────────────────────────────────────────────

  /** Mark a step as completed (done=true, success recorded). */
  markStepDone(plan: ToolPlan, stepId: number, success: boolean): void {
    const step = plan.steps.find((s) => s.id === stepId);
    if (step) {
      step.done    = true;
      step.success = success;
    }
    this.stepResults.push({ stepId, success });
  }

  /**
   * Update the plan based on a step result.
   *
   * If the result reveals new information (e.g. a file was not found),
   * insert a recovery step or remove now-unnecessary steps.
   *
   * @param plan       - The current plan (mutated in place).
   * @param stepResult - Text output from the last executed step.
   */
  updatePlanAfterStep(plan: ToolPlan, stepResult: string): void {
    // If a search or read returned "not found", remove subsequent edit steps
    // that depended on that result and insert an exploration step instead.
    const notFound = /no (files|results|matches) found|enoent|does not exist/i.test(stepResult);
    if (notFound) {
      const pendingEdits = plan.steps.filter(
        (s) => !s.done && (s.tool === 'edit_file' || s.tool === 'write_file'),
      );
      if (pendingEdits.length > 0) {
        // Insert a broad search step before the first edit
        const nextId = (plan.steps.at(-1)?.id ?? 0) + 1;
        const searchStep: ToolPlanStep = {
          id:      nextId,
          tool:    'search_files',
          args:    { pattern: 'src/**/*.ts' },
          purpose: 'Re-explore repository after unexpected empty result',
        };
        const firstEditIdx = plan.steps.indexOf(pendingEdits[0]);
        plan.steps.splice(firstEditIdx, 0, searchStep);
        plan.adjustments++;
        logger.debug('[tool-planner] Inserted re-exploration step after empty result');
      }
    }
  }

  // ── Metrics ────────────────────────────────────────────────────────────────

  /** Compute and log plan execution metrics. */
  computeMetrics(plan: ToolPlan): PlanMetrics {
    const executionTimeMs = Date.now() - this.planStartTime;
    const total    = plan.steps.length;
    const done     = plan.steps.filter((s) => s.done).length;
    const succeded = this.stepResults.filter((r) => r.success).length;
    const failed   = this.stepResults.filter((r) => !r.success).length;
    const rate     = done > 0 ? succeded / done : 0;

    const metrics: PlanMetrics = {
      steps:           total,
      adjustments:     plan.adjustments,
      executionTimeMs,
      successfulSteps: succeded,
      failedSteps:     failed,
      successRate:     Math.round(rate * 100) / 100,
    };

    logger.debug(
      `[tool-planner] PLAN METRICS steps=${metrics.steps} adj=${metrics.adjustments} ` +
      `time=${(executionTimeMs / 1000).toFixed(1)}s successRate=${Math.round(rate * 100)}%`,
    );

    return metrics;
  }

  /** Format metrics for human-readable log output. */
  static formatMetrics(m: PlanMetrics): string {
    return [
      'PLAN METRICS',
      `  steps:       ${m.steps}`,
      `  adjustments: ${m.adjustments}`,
      `  time:        ${(m.executionTimeMs / 1000).toFixed(1)}s`,
      `  successRate: ${Math.round(m.successRate * 100)}%`,
    ].join('\n');
  }
}
