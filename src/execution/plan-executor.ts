import { ReasoningEngine } from '../ai/reasoning/reasoning-engine.js';
import type { ExecutionPlan, PlanStep } from '../ai/reasoning/planning-engine.js';
import type { AIProvider, ChatMessage } from '../ai/types.js';
import type { RepoIndex } from '../types/index.js';
import type { ChatContext } from '../ai/reasoning/reasoning-engine.js';
import { WorktreeManager } from '../runtime/worktree-manager.js';
import { logger } from '../utils/logger.js';

// ── Public constants ──────────────────────────────────────────────────────────

/** Hard cap on total tool calls across all steps (prevents runaway execution). */
export const MAX_TOOL_CALLS = 50;

/** Rounds per step: enough for real implementation work without infinite loops. */
const ROUNDS_PER_STEP = 20;

// ── Public types ──────────────────────────────────────────────────────────────

export interface StepContext {
  stepId:          number;
  description:     string;
  filesModified:   string[];
  toolCallCount:   number;
  errors:          string[];
  durationMs:      number;
}

export interface ExecutionMetrics {
  stepsExecuted:   number;
  filesModified:   string[];
  toolsUsed:       string[];
  totalToolCalls:  number;
  durationMs:      number;
  stepContexts:    StepContext[];
  verificationStatus: 'PASSED' | 'FAILED' | 'SKIPPED';
}

// ── PlanExecutor ──────────────────────────────────────────────────────────────

/**
 * PlanExecutor — executes a structured ExecutionPlan step by step.
 *
 * Each step:
 *   1. Runs ReasoningEngine.chat() with the step description injected (up to
 *      ROUNDS_PER_STEP tool rounds — far more than the old MAX_ROUNDS = 5).
 *   2. Tracks per-step context: filesModified, toolCalls, errors, duration.
 *   3. Feeds step context to the VerificationLoop for targeted fixes.
 *
 * Safety guards:
 *   - MAX_TOOL_CALLS = 50 across all steps combined
 *   - AbortSignal cancels between steps
 */
export class PlanExecutor {
  private filesModified:   Set<string>    = new Set();
  private toolsUsed:       Set<string>    = new Set();
  private totalToolCalls                  = 0;
  private stepContexts:    StepContext[]  = [];
  private worktreeManager: WorktreeManager;

  constructor(
    private provider:    AIProvider,
    private index:       RepoIndex | null,
    private chatContext: ChatContext,
  ) {
    this.worktreeManager = new WorktreeManager(chatContext.rootPath);
  }

  /**
   * Execute all steps in the plan sequentially.
   *
   * @param plan       - The execution plan from PlanningEngine.
   * @param history    - Rolling conversation history (shared with outer session).
   * @param onStep     - Called before each step starts (step, index, total).
   * @param onStage    - Progress indicator (structured label messages).
   * @param onChunk    - Called with streamed text output from each step.
   * @param signal     - Optional AbortSignal — cancels between steps.
   */
  async execute(
    plan:      ExecutionPlan,
    history:   ChatMessage[],
    onStep?:   (step: PlanStep, index: number, total: number) => void,
    onStage?:  (message: string) => void,
    onChunk?:  (chunk: string) => void,
    signal?:   AbortSignal,
    taskName?: string,
  ): Promise<{ response: string; metrics: Omit<ExecutionMetrics, 'verificationStatus'>; worktreePath?: string }> {
    const startTime = Date.now();
    let fullResponse  = '';
    let stepsExecuted = 0;

    // ── Worktree isolation ─────────────────────────────────────────────────
    const effectiveTaskName = taskName ?? `task-${Date.now()}`;
    let worktreePath: string | undefined;

    try {
      worktreePath = await this.worktreeManager.createWorktree(effectiveTaskName);
      onStage?.(`WORKTREE created ${worktreePath}`);
      logger.debug(`[plan-executor] Worktree created: ${worktreePath}`);
    } catch (err) {
      // Non-fatal: if git worktrees are not supported (e.g. shallow clones),
      // fall back to executing in the main working tree
      logger.warn(`[plan-executor] Worktree creation failed — falling back to main tree: ${(err as Error).message}`);
      onStage?.(`WARN Worktree unavailable — executing in main tree`);
    }

    // Use a local copy of history to avoid mutating the caller's array
    const localHistory: ChatMessage[] = [...history];
    const engine = new ReasoningEngine(this.index, this.provider);

    for (let i = 0; i < plan.steps.length; i++) {
      if (signal?.aborted) {
        logger.debug('[plan-executor] Aborted between steps');
        break;
      }

      if (this.totalToolCalls >= MAX_TOOL_CALLS) {
        onStage?.(`WARN MAX_TOOL_CALLS (${MAX_TOOL_CALLS}) reached — stopping early`);
        logger.warn('[plan-executor] MAX_TOOL_CALLS reached');
        break;
      }

      const step = plan.steps[i];
      onStep?.(step, i, plan.steps.length);
      logger.debug(`[plan-executor] Step ${step.id}/${plan.steps.length}: ${step.description}`);

      // ── Per-step context tracking ───────────────────────────────────────
      const stepStartTime     = Date.now();
      const stepFilesModified = new Set<string>();
      let   stepToolCalls     = 0;
      const stepErrors: string[] = [];

      const stepPrompt = [
        `Execute step ${step.id}: ${step.description}`,
        '',
        `Context: This is step ${step.id} of ${plan.steps.length} for task: "${plan.query}"`,
        'Focus only on this step. Use tools as needed.',
        'After writing any file, verify the change looks correct.',
      ].join('\n');

      let stepResponse = '';

      try {
        await engine.chat(
          stepPrompt,
          this.chatContext,
          localHistory,
          (chunk) => {
            stepResponse += chunk;
            onChunk?.(chunk);
          },
          (stage) => {
            onStage?.(stage);
            // Track file writes from structured stage messages
            if (stage.startsWith('WRITE ')) {
              const token = stage.slice(6).split(/\s+/)[0];
              if (token && !token.startsWith('(')) {
                this.filesModified.add(token);
                stepFilesModified.add(token);
              }
            }
          },
          undefined,   // onPlan — suppress inner plan display
          undefined,   // onContext
          (toolName) => {
            this.toolsUsed.add(toolName);
            this.totalToolCalls++;
            stepToolCalls++;
          },
          signal,
          { maxRounds: ROUNDS_PER_STEP },
        );
      } catch (err) {
        const msg = (err as Error).message;
        stepErrors.push(msg);
        logger.warn(`[plan-executor] Step ${step.id} error: ${msg}`);
        onStage?.(`WARN Step ${step.id} error: ${msg.slice(0, 80)}`);
      }

      // Record per-step context
      this.stepContexts.push({
        stepId:        step.id,
        description:   step.description,
        filesModified: Array.from(stepFilesModified),
        toolCallCount: stepToolCalls,
        errors:        stepErrors,
        durationMs:    Date.now() - stepStartTime,
      });

      stepsExecuted++;

      if (stepResponse) {
        fullResponse += `\n\n**Step ${step.id}: ${step.description}**\n${stepResponse}`;
        // Grow history so next step sees this step's output
        localHistory.push({ role: 'assistant', content: stepResponse });
      }
    }

    return {
      response: fullResponse.trim(),
      metrics: {
        stepsExecuted,
        filesModified:  Array.from(this.filesModified),
        toolsUsed:      Array.from(this.toolsUsed),
        totalToolCalls: this.totalToolCalls,
        durationMs:     Date.now() - startTime,
        stepContexts:   this.stepContexts,
      },
      worktreePath,
    };
  }

  /**
   * Merge the task's worktree branch into the main tree after successful
   * verification.  No-op if no worktree was created.
   */
  async mergeWorktree(taskName?: string): Promise<void> {
    const name = taskName ?? `task-${Date.now()}`;
    if (!this.worktreeManager.getWorktreePath(name)) return;
    await this.worktreeManager.mergeWorktree(name);
  }

  /**
   * Remove the task's worktree (called on failure or explicit cleanup).
   * No-op if no worktree was created.
   */
  async removeWorktree(taskName?: string): Promise<void> {
    const name = taskName ?? `task-${Date.now()}`;
    if (!this.worktreeManager.getWorktreePath(name)) return;
    await this.worktreeManager.removeWorktree(name);
  }

  /** Remove all managed worktrees (safety cleanup on shutdown). */
  async cleanupWorktrees(): Promise<void> {
    await this.worktreeManager.cleanup();
  }

  /** Expose step contexts for use by VerificationLoop. */
  getStepContexts(): StepContext[] {
    return [...this.stepContexts];
  }
}
