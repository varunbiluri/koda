/**
 * RefactorAgent — specialist worker for improving code quality without
 * changing observable behavior.
 */
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import type { AIProvider, ChatMessage } from '../../ai/types.js';
import type { RepoIndex } from '../../types/index.js';
import type { ChatContext } from '../../ai/reasoning/reasoning-engine.js';
import type { WorkerOptions, WorkerResult } from './coding-agent.js';
import { logger } from '../../utils/logger.js';

const REFACTOR_INSTRUCTIONS = [
  'You are a specialist refactoring agent. Improve code quality and structure without changing behavior.',
  '',
  'Preferred tools (in order):',
  '  1. grep_code      — find duplicated patterns and symbols to refactor',
  '  2. read_file      — read files fully before changing them',
  '  3. edit_file      — make targeted, minimal changes',
  '  4. run_terminal   — verify compilation and tests still pass after edits',
  '',
  'Rules:',
  '- Read the entire file before making any changes.',
  '- Change only what is necessary to improve quality: naming, structure, duplication, complexity.',
  '- Do NOT change observable behavior, public APIs, or function signatures unless asked.',
  '- Prefer edit_file for targeted changes — avoid rewriting whole files.',
  '- After refactoring, verify the code still compiles and tests still pass.',
  '- Eliminate duplicated logic by extracting shared helpers.',
  '- Replace magic numbers and strings with named constants.',
  '- Improve readability: break large functions, clarify variable names.',
].join('\n');

export class RefactorAgent {
  private engine: ReasoningEngine;

  constructor(index: RepoIndex | null, provider: AIProvider) {
    this.engine = new ReasoningEngine(index, provider);
  }

  async execute(
    task:      string,
    context:   ChatContext,
    history:   ChatMessage[],
    onChunk?:  (chunk: string) => void,
    onStage?:  (stage: string) => void,
    options:   WorkerOptions = {},
  ): Promise<WorkerResult> {
    const start = Date.now();
    let output = '';
    let toolCallCount = 0;

    const prompt = `${REFACTOR_INSTRUCTIONS}\n\nTask: ${task}`;

    logger.debug(`[RefactorAgent] Starting: ${task.slice(0, 80)}`);

    try {
      await this.engine.chat(
        prompt,
        context,
        history,
        (chunk) => { output += chunk; onChunk?.(chunk); },
        onStage,
        undefined,
        undefined,
        () => { toolCallCount++; },
        options.signal,
        { maxRounds: options.maxRounds ?? 15 },
      );
      logger.debug(`[RefactorAgent] Done in ${Date.now() - start}ms, ${toolCallCount} tools`);
      return { output, success: true, durationMs: Date.now() - start, toolCallCount };
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn(`[RefactorAgent] Failed: ${msg}`);
      return { output: `Error: ${msg}`, success: false, durationMs: Date.now() - start, toolCallCount };
    }
  }
}
