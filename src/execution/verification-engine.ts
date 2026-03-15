import { ReasoningEngine } from '../ai/reasoning/reasoning-engine.js';
import type { AIProvider, ChatMessage } from '../ai/types.js';
import type { RepoIndex } from '../types/index.js';
import type { ChatContext } from '../ai/reasoning/reasoning-engine.js';
import type { StepContext } from './plan-executor.js';
import { logger } from '../utils/logger.js';

// ── Public constants ──────────────────────────────────────────────────────────

export const MAX_VERIFY_ROUNDS = 3;

// ── Public types ──────────────────────────────────────────────────────────────

/** Structured result of a single verification pass. */
export interface VerificationPassResult {
  typeCheckPassed: boolean;
  lintPassed:      boolean;
  testsPassed:     boolean;
  passed:          boolean;
  errors:          string[];
  durationMs:      number;
}

/** Final outcome of the full verification loop. */
export interface VerificationOutcome {
  passed:      boolean;
  roundsRun:   number;
  errors:      string[];
  /** Duration of the final passing/failing verification pass in ms. */
  durationMs:  number;
}

// ── VerificationLoop ──────────────────────────────────────────────────────────

/**
 * VerificationLoop — structured, ordered verification pipeline with
 * LLM-driven root-cause analysis and automatic fix attempts.
 *
 * Verification order (Phase 9):
 *   1. tsc --noEmit   (type checking)
 *   2. lint           (eslint / project linter)
 *   3. tests          (npm test / vitest / jest)
 *
 * On failure (Phase 6):
 *   1. Capture error output
 *   2. Run root-cause analysis prompt → structured fix plan
 *   3. Apply fix via ReasoningEngine.chat()
 *   4. Re-run full verification pipeline
 *
 * Safety guard: MAX_VERIFY_ROUNDS = 3 prevents infinite fix loops.
 */
export class VerificationLoop {
  static readonly MAX_VERIFY_ROUNDS = MAX_VERIFY_ROUNDS;

  constructor(
    private provider:    AIProvider,
    private index:       RepoIndex | null,
    private chatContext: ChatContext,
  ) {}

  /**
   * Run verification with automatic LLM-driven retries.
   *
   * @param rootPath     - Repository root for running build/test/lint commands.
   * @param history      - Rolling conversation history for the fix messages.
   * @param onStage      - Progress indicator callback.
   * @param signal       - Optional AbortSignal.
   * @param stepContexts - Per-step execution context from PlanExecutor (used
   *                       to focus the fix prompt on recently modified files).
   */
  async runWithRetry(
    rootPath:      string,
    history:       ChatMessage[],
    onStage?:      (message: string) => void,
    signal?:       AbortSignal,
    stepContexts?: StepContext[],
  ): Promise<VerificationOutcome> {
    // Lazy import to avoid circular dependency and keep startup fast
    const { VerificationEngine } = await import('../evaluation/verification-engine.js');
    const verifier = new VerificationEngine();

    const localHistory: ChatMessage[] = [...history];
    const allErrors: string[] = [];
    let lastDurationMs = 0;

    for (let round = 0; round < MAX_VERIFY_ROUNDS; round++) {
      if (signal?.aborted) break;

      onStage?.(`INFO Verification round ${round + 1}/${MAX_VERIFY_ROUNDS} (tsc → lint → tests)`);
      logger.debug(`[verification-loop] Round ${round + 1}`);

      const t0     = Date.now();
      const result = await verifier.verify(rootPath);
      lastDurationMs = Date.now() - t0;

      if (result.success) {
        onStage?.('OK Verification PASSED');
        logger.info('[verification-loop] Verification passed');
        return { passed: true, roundsRun: round + 1, errors: [], durationMs: lastDurationMs };
      }

      const errors = result.errors.slice(0, 8);
      allErrors.push(...errors);
      onStage?.(`WARN Verification failed — ${errors.length} error(s) in round ${round + 1}`);
      logger.warn(`[verification-loop] Round ${round + 1} failed: ${errors[0] ?? 'unknown error'}`);

      // Last round — no fix attempt needed
      if (round >= MAX_VERIFY_ROUNDS - 1) break;

      // ── Root Cause Analysis + Fix ─────────────────────────────────────────
      onStage?.(`INFO Analyzing root cause (round ${round + 1})`);

      const recentFiles = stepContexts
        ? stepContexts.flatMap((s) => s.filesModified).filter(Boolean)
        : [];

      const fixPrompt = buildRcaPrompt(errors, recentFiles);

      const engine = new ReasoningEngine(this.index, this.provider);
      try {
        let fixResponse = '';
        await engine.chat(
          fixPrompt,
          this.chatContext,
          localHistory,
          (chunk) => { fixResponse += chunk; },
          onStage,
          undefined,
          undefined,
          undefined,
          signal,
          { maxRounds: 10 }, // enough for read + fix + verify reads
        );
        if (fixResponse) {
          localHistory.push({ role: 'assistant', content: fixResponse });
        }
      } catch (err) {
        logger.warn(`[verification-loop] Fix attempt ${round + 1} failed: ${(err as Error).message}`);
      }
    }

    onStage?.(`WARN Verification FAILED after ${MAX_VERIFY_ROUNDS} rounds`);
    return {
      passed:    false,
      roundsRun: MAX_VERIFY_ROUNDS,
      errors:    allErrors,
      durationMs: lastDurationMs,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a root-cause analysis prompt that gives the LLM:
 *   1. The exact error output
 *   2. The recently modified files to focus on
 *   3. A structured fix instruction
 */
function buildRcaPrompt(errors: string[], recentFiles: string[]): string {
  const errorBlock = errors.map((e) => `  ${e}`).join('\n');

  const fileHint = recentFiles.length > 0
    ? `\nFiles modified in the last execution step:\n${recentFiles.map((f) => `  - ${f}`).join('\n')}\n`
    : '';

  return [
    'Verification failed. Perform root cause analysis and fix the issues.',
    '',
    'Error output:',
    '```',
    errorBlock,
    '```',
    fileHint,
    'Instructions:',
    '1. Read the files mentioned in the errors to understand the root cause.',
    '2. Identify whether this is a type error, missing import, logic error, or test failure.',
    '3. Apply the minimal fix using edit_file (prefer this over write_file for edits).',
    '4. After fixing, re-read the modified file to confirm the change is correct.',
    '',
    'Fix the root cause — do not add workarounds or suppress errors.',
  ].join('\n');
}
