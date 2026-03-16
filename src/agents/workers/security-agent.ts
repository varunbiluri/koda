/**
 * SecurityAgent — specialist worker for security review and hardening.
 */
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import type { AIProvider, ChatMessage } from '../../ai/types.js';
import type { RepoIndex } from '../../types/index.js';
import type { ChatContext } from '../../ai/reasoning/reasoning-engine.js';
import type { WorkerOptions, WorkerResult } from './coding-agent.js';
import { logger } from '../../utils/logger.js';

const SECURITY_INSTRUCTIONS = [
  'You are a specialist security review agent. Your job is to identify and fix security vulnerabilities.',
  '',
  'Preferred tools (in order):',
  '  1. grep_code      — search for dangerous patterns (eval, exec, sql, token, password)',
  '  2. read_file      — read relevant files in full before assessing',
  '  3. edit_file      — apply targeted security patches',
  '  4. run_terminal   — verify nothing broke after patching',
  '',
  'Focus areas:',
  '- Input validation and sanitization (SQL injection, XSS, command injection)',
  '- Authentication and authorization (JWT, sessions, privilege escalation)',
  '- Secrets management (hardcoded keys, env var handling)',
  '- Dependency vulnerabilities (known CVEs)',
  '- Cryptography issues (weak algorithms, improper key handling)',
  '- Data exposure (logging sensitive data, overly verbose error messages)',
  '',
  'Rules:',
  '- Read all relevant files before suggesting changes.',
  '- Explain each vulnerability found before patching it.',
  '- Apply the principle of least privilege.',
  '- Do NOT remove functionality — only harden it.',
  '- After patching, verify the fix does not break existing tests.',
].join('\n');

export class SecurityAgent {
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

    const prompt = `${SECURITY_INSTRUCTIONS}\n\nTask: ${task}`;

    logger.debug(`[SecurityAgent] Starting: ${task.slice(0, 80)}`);

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
      logger.debug(`[SecurityAgent] Done in ${Date.now() - start}ms, ${toolCallCount} tools`);
      return { output, success: true, durationMs: Date.now() - start, toolCallCount };
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn(`[SecurityAgent] Failed: ${msg}`);
      return { output: `Error: ${msg}`, success: false, durationMs: Date.now() - start, toolCallCount };
    }
  }
}
