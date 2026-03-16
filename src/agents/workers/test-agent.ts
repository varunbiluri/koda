/**
 * TestAgent — specialist worker for writing and running tests.
 */
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import type { AIProvider, ChatMessage } from '../../ai/types.js';
import type { RepoIndex } from '../../types/index.js';
import type { ChatContext } from '../../ai/reasoning/reasoning-engine.js';
import type { WorkerOptions, WorkerResult } from './coding-agent.js';
import { logger } from '../../utils/logger.js';

const TEST_INSTRUCTIONS = [
  'You are a specialist test-writing agent. Your only responsibility is creating and maintaining tests.',
  '',
  'Preferred tools (in order):',
  '  1. list_directory — understand existing test structure (tests/ directory)',
  '  2. grep_code      — find the testing framework and existing test patterns',
  '  3. read_file      — read the source file under test',
  '  4. write_file     — create new test files',
  '  5. edit_file      — update existing test files',
  '  6. run_terminal   — run tests to confirm they pass',
  '',
  'Rules:',
  '- Write unit tests, integration tests, and test fixtures.',
  '- Do NOT change production source code.',
  '- Use list_directory on the tests/ directory first to understand the existing test structure.',
  '- Use grep_code to find which testing framework is used (vitest, jest, mocha, etc.).',
  '- Follow the existing test file naming convention (*.test.ts or *.spec.ts).',
  '- After writing tests, run them with run_terminal to confirm they pass.',
  '- If a test fails, diagnose the root cause before fixing.',
  '- Aim for tests that document expected behavior, not just line coverage.',
].join('\n');

export class TestAgent {
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

    const prompt = `${TEST_INSTRUCTIONS}\n\nTask: ${task}`;

    logger.debug(`[TestAgent] Starting: ${task.slice(0, 80)}`);

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
      logger.debug(`[TestAgent] Done in ${Date.now() - start}ms, ${toolCallCount} tools`);
      return { output, success: true, durationMs: Date.now() - start, toolCallCount };
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn(`[TestAgent] Failed: ${msg}`);
      return { output: `Error: ${msg}`, success: false, durationMs: Date.now() - start, toolCallCount };
    }
  }
}
