/**
 * CodingAgent — specialist worker for writing and modifying source code.
 *
 * Wraps ReasoningEngine.chat() with a focused system prompt that restricts
 * the agent to implementation work only (no tests, no docs).
 */
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import type { AIProvider, ChatMessage } from '../../ai/types.js';
import type { RepoIndex } from '../../types/index.js';
import type { ChatContext } from '../../ai/reasoning/reasoning-engine.js';
import { logger } from '../../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkerOptions {
  maxRounds?: number;
  signal?:    AbortSignal;
}

export interface WorkerResult {
  output:        string;
  success:       boolean;
  durationMs:    number;
  toolCallCount: number;
}

// ── System prompt ──────────────────────────────────────────────────────────────

const CODING_INSTRUCTIONS = [
  'You are a specialist coding agent. Your only responsibility is implementing source code.',
  '',
  'Preferred tools (in order):',
  '  1. search_files   — locate files before reading anything',
  '  2. grep_code      — find symbols, imports, class definitions',
  '  3. read_file      — read a specific file once located',
  '  4. edit_file      — make targeted changes to existing files',
  '  5. write_file     — only for new files or complete rewrites',
  '  6. run_terminal   — compile/lint check after edits',
  '',
  'Rules:',
  '- Write, edit, and create source code files only.',
  '- Do NOT write tests or update documentation unless the task explicitly requires it.',
  '- Always use search_files and grep_code to explore relevant code before editing.',
  '- Read a file fully before modifying it.',
  '- Prefer edit_file over write_file for existing files.',
  '- After every write or edit, verify the result looks correct.',
  '- Match existing code style, naming conventions, and architectural patterns.',
  '- Import only what already exists in the codebase — do not invent modules.',
].join('\n');

// ── CodingAgent ────────────────────────────────────────────────────────────────

export class CodingAgent {
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

    const prompt = `${CODING_INSTRUCTIONS}\n\nTask: ${task}`;

    logger.debug(`[CodingAgent] Starting: ${task.slice(0, 80)}`);

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
      logger.debug(`[CodingAgent] Done in ${Date.now() - start}ms, ${toolCallCount} tools`);
      return { output, success: true, durationMs: Date.now() - start, toolCallCount };
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn(`[CodingAgent] Failed: ${msg}`);
      return { output: `Error: ${msg}`, success: false, durationMs: Date.now() - start, toolCallCount };
    }
  }
}
