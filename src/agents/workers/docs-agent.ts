/**
 * DocsAgent — specialist worker for documentation and code comments.
 */
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import type { AIProvider, ChatMessage } from '../../ai/types.js';
import type { RepoIndex } from '../../types/index.js';
import type { ChatContext } from '../../ai/reasoning/reasoning-engine.js';
import type { WorkerOptions, WorkerResult } from './coding-agent.js';
import { logger } from '../../utils/logger.js';

const DOCS_INSTRUCTIONS = [
  'You are a specialist documentation agent. Your only responsibility is documentation.',
  '',
  'Rules:',
  '- Add or update: JSDoc comments, inline comments, README sections, and API docs.',
  '- Do NOT change any logic, function implementations, or test files.',
  '- Read each file carefully before adding documentation.',
  '- Write clear, concise documentation that explains why, not just what.',
  '- Use TSDoc/JSDoc format for TypeScript: @param, @returns, @throws, @example.',
  '- For README updates: keep existing sections, only add or update what is relevant.',
  '- Avoid redundant comments that merely repeat what the code already expresses.',
  '- Prefer documenting public APIs, exported functions, and complex internal logic.',
].join('\n');

export class DocsAgent {
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

    const prompt = `${DOCS_INSTRUCTIONS}\n\nTask: ${task}`;

    logger.debug(`[DocsAgent] Starting: ${task.slice(0, 80)}`);

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
        { maxRounds: options.maxRounds ?? 12 },
      );
      logger.debug(`[DocsAgent] Done in ${Date.now() - start}ms, ${toolCallCount} tools`);
      return { output, success: true, durationMs: Date.now() - start, toolCallCount };
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn(`[DocsAgent] Failed: ${msg}`);
      return { output: `Error: ${msg}`, success: false, durationMs: Date.now() - start, toolCallCount };
    }
  }
}
