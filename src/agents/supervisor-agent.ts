import { ReasoningEngine } from '../ai/reasoning/reasoning-engine.js';
import type { AIProvider, ChatMessage } from '../ai/types.js';
import type { RepoIndex } from '../types/index.js';
import type { ChatContext } from '../ai/reasoning/reasoning-engine.js';
import { RepositoryExplorer } from './repository-explorer.js';
import { ToolPlanner, formatToolPlan } from '../planning/tool-planner.js';
import { logger } from '../utils/logger.js';

// ── Sub-agent specialisations ─────────────────────────────────────────────────

export type SubAgentRole =
  | 'CodingAgent'
  | 'TestAgent'
  | 'RefactorAgent'
  | 'DocumentationAgent';

export interface SubTask {
  role:        SubAgentRole;
  description: string;
  /** Output collected from this sub-agent's ReasoningEngine.chat() call. */
  output?:     string;
  /** Whether the sub-task completed without error. */
  success:     boolean;
  durationMs:  number;
}

export interface DelegationResult {
  /** Original task handed to the supervisor. */
  task:        string;
  subTasks:    SubTask[];
  /** Aggregated response combining all sub-agent outputs. */
  response:    string;
  /** Union of all files mentioned across sub-tasks (best-effort). */
  filesHinted: string[];
  durationMs:  number;
}

// ── System prompts per role ───────────────────────────────────────────────────

const ROLE_PROMPTS: Record<SubAgentRole, string> = {
  CodingAgent:
    'You are a specialist coding agent. Focus exclusively on writing, editing, and creating source code files. ' +
    'Use the available tools to read existing files before modifying them. ' +
    'After every file write or edit, verify the change looks correct.',

  TestAgent:
    'You are a specialist test-writing agent. Focus exclusively on creating or updating test files. ' +
    'Check the existing test structure first (list_files on the tests/ directory), then write targeted tests. ' +
    'Run the tests with run_terminal after writing them to confirm they pass.',

  RefactorAgent:
    'You are a specialist refactoring agent. Focus on improving code quality, naming, and structure ' +
    'without changing observable behaviour. Use edit_file for targeted changes. ' +
    'Read the file fully before making any edit.',

  DocumentationAgent:
    'You are a specialist documentation agent. Focus on adding or updating comments, JSDoc, README sections, ' +
    'or inline documentation. Do not change logic — only documentation.',
};

// ── Role detection heuristics ─────────────────────────────────────────────────

function inferSubTasks(task: string): SubTask[] {
  const lower = task.toLowerCase();
  const subTasks: Omit<SubTask, 'output' | 'durationMs'>[] = [];

  // Always start with a CodingAgent for the core implementation
  subTasks.push({ role: 'CodingAgent', description: task, success: false });

  // Add TestAgent if the task mentions testing
  if (/\b(test|spec|unit|coverage|tdd)\b/.test(lower)) {
    subTasks.push({
      role:        'TestAgent',
      description: `Write tests for: ${task}`,
      success:     false,
    });
  }

  // Add RefactorAgent if the task is a refactor/cleanup
  if (/\b(refactor|clean|rename|restructure|extract|simplify)\b/.test(lower)) {
    subTasks.push({
      role:        'RefactorAgent',
      description: `Refactor: ${task}`,
      success:     false,
    });
  }

  // Add DocumentationAgent if docs are mentioned
  if (/\b(doc|document|comment|jsdoc|readme|explain)\b/.test(lower)) {
    subTasks.push({
      role:        'DocumentationAgent',
      description: `Document: ${task}`,
      success:     false,
    });
  }

  // If only the CodingAgent was added, also add TestAgent by default for
  // implementation tasks (best practice — always write at least basic tests)
  if (subTasks.length === 1 && /\b(implement|add|build|create|write)\b/.test(lower)) {
    subTasks.push({
      role:        'TestAgent',
      description: `Write tests for the implementation: ${task}`,
      success:     false,
    });
  }

  return subTasks.map((t) => ({ ...t, durationMs: 0 }));
}

// ── SupervisorAgent ───────────────────────────────────────────────────────────

/**
 * SupervisorAgent — splits a complex task into specialised sub-agent roles and
 * executes them sequentially via `ReasoningEngine.chat()`.
 *
 * Each sub-agent receives:
 *   - Its role-specific system context prepended to the task description.
 *   - The accumulated conversation history from previous sub-agents, so later
 *     agents (e.g. TestAgent) can see what CodingAgent produced.
 *
 * This mirrors the human pattern of: implement → test → document.
 */
/**
 * Threshold: run RepositoryExplorer pre-flight when task mentions this many
 * or more distinct file-like tokens, or when complexity is HIGH.
 */
const EXPLORER_FILE_COUNT_THRESHOLD = 8;

export class SupervisorAgent {
  private engine:     ReasoningEngine;
  private explorer:   RepositoryExplorer;
  private toolPlanner: ToolPlanner;

  constructor(
    private readonly index:       RepoIndex | null,
    private readonly provider:    AIProvider,
    private readonly chatContext: ChatContext,
  ) {
    this.engine      = new ReasoningEngine(index, provider);
    this.explorer    = new RepositoryExplorer(chatContext.rootPath);
    this.toolPlanner = new ToolPlanner(provider);
  }

  /**
   * Delegate a complex task to specialised sub-agents.
   *
   * For complex tasks (high file count or HIGH complexity) a RepositoryExplorer
   * pre-flight runs before CodingAgent to inject repo structure context.
   *
   * @param task       - Free-form task description (complex query).
   * @param history    - Rolling conversation history (shared with outer session).
   * @param onChunk    - Streams text from each sub-agent as it runs.
   * @param onStage    - Progress indicator callback.
   * @param signal     - Optional AbortSignal.
   * @param complexity - Optional complexity label ('LOW' | 'MEDIUM' | 'HIGH').
   */
  async delegate(
    task:        string,
    history:     ChatMessage[],
    onChunk?:    (chunk: string) => void,
    onStage?:    (message: string) => void,
    signal?:     AbortSignal,
    complexity?: string,
  ): Promise<DelegationResult> {
    const start       = Date.now();
    const subTasks    = inferSubTasks(task);
    const localHistory: ChatMessage[] = [...history];
    const filesHinted = new Set<string>();

    logger.debug(
      `[supervisor] Delegating "${task}" → ${subTasks.map((t) => t.role).join(', ')}`,
    );

    onStage?.(`AGENT supervisor delegating to ${subTasks.length} sub-agent(s)`);

    // ── Pre-flight: RepositoryExplorer for complex tasks ──────────────────
    const mentionedFileCount = (task.match(/\b\w+\.[a-z]{1,5}\b/g) ?? []).length;
    const isComplex = complexity === 'HIGH' || mentionedFileCount >= EXPLORER_FILE_COUNT_THRESHOLD;
    let explorerSummary = '';

    if (isComplex) {
      onStage?.('AGENT RepositoryExplorer scanning repository');
      try {
        const repoCtx    = await this.explorer.explore();
        explorerSummary  = repoCtx.summary;
        logger.debug('[supervisor] RepositoryExplorer complete');
        onStage?.('AGENT RepositoryExplorer complete');
      } catch (err) {
        logger.warn(`[supervisor] RepositoryExplorer failed: ${(err as Error).message}`);
      }
    }

    // ── Pre-flight: ToolPlanner generates tool sequence ───────────────────
    let toolPlanBlock = '';
    try {
      const toolPlan  = await this.toolPlanner.generateToolPlan(task, explorerSummary);
      toolPlanBlock   = formatToolPlan(toolPlan);
    } catch (err) {
      logger.warn(`[supervisor] ToolPlanner failed: ${(err as Error).message}`);
    }

    for (const subTask of subTasks) {
      if (signal?.aborted) break;

      const rolePrompt = ROLE_PROMPTS[subTask.role];
      const contextBlock = (explorerSummary && subTask.role === 'CodingAgent')
        ? `\n\n${explorerSummary}`
        : '';
      const planBlock = toolPlanBlock ? `\n\n${toolPlanBlock}` : '';
      const prompt = [
        `[${subTask.role}] ${rolePrompt}`,
        '',
        `Task: ${subTask.description}`,
        ...(contextBlock ? [contextBlock] : []),
        ...(planBlock    ? [planBlock]    : []),
      ].join('\n');

      onStage?.(`AGENT ${subTask.role} starting`);
      logger.debug(`[supervisor] Running ${subTask.role}: ${subTask.description}`);

      const stepStart = Date.now();
      let output = '';

      try {
        await this.engine.chat(
          prompt,
          this.chatContext,
          localHistory,
          (chunk) => {
            output += chunk;
            onChunk?.(chunk);
          },
          onStage,
          undefined,   // onPlan
          undefined,   // onContext
          undefined,   // onToolUsed
          signal,
          { maxRounds: 15 },
        );

        subTask.success    = true;
        subTask.output     = output;
        subTask.durationMs = Date.now() - stepStart;

        // Harvest file hints from structured stage messages in the response
        for (const match of output.matchAll(/\b(src\/[^\s"'`]+\.(?:ts|js|py|go|rs))\b/g)) {
          filesHinted.add(match[1]);
        }

        // Grow shared history so subsequent agents see this agent's work
        if (output.trim()) {
          localHistory.push({ role: 'assistant', content: output });
        }

        onStage?.(`AGENT ${subTask.role} complete`);
      } catch (err) {
        const msg = (err as Error).message;
        subTask.success    = false;
        subTask.output     = `Error: ${msg}`;
        subTask.durationMs = Date.now() - stepStart;
        logger.warn(`[supervisor] ${subTask.role} failed: ${msg}`);
        onStage?.(`WARN ${subTask.role} failed: ${msg.slice(0, 80)}`);
        // Continue with remaining sub-agents despite failure
      }
    }

    // Build aggregated response
    const response = subTasks
      .filter((t) => t.output)
      .map((t) => `**[${t.role}]**\n${t.output ?? ''}`)
      .join('\n\n---\n\n');

    return {
      task,
      subTasks,
      response,
      filesHinted: Array.from(filesHinted),
      durationMs:  Date.now() - start,
    };
  }
}
