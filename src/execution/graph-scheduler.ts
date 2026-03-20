/**
 * GraphScheduler — executes an ExecutionGraph with parallel node scheduling,
 * context isolation, failure recovery, retries, and telemetry.
 *
 * Architecture:
 *
 *   GraphScheduler.run(graph)
 *     │
 *     ├── [while nodes remain]
 *     │     ├── getRunnableNodes()          ← dependency-resolved, priority-sorted
 *     │     ├── [launch up to maxParallel]  ← parallel execution via Promise.race
 *     │     └── per node:
 *     │           ├── build isolated context  ← NO shared conversation history
 *     │           ├── run ReasoningEngine.chat() with fresh [] history
 *     │           ├── store tool results in ToolResultIndex
 *     │           ├── markCompleted | markFailed
 *     │           └── if failed: insertRecoveryNode via FailureAnalyzer
 *     │
 *     └── periodic state persistence to ExecutionStateStore
 *
 * Context Isolation Guarantee:
 *   Each node calls ReasoningEngine.chat() with `localHistory = []`.
 *   Node context is built from:
 *     - The node's own task description
 *     - Summaries of completed dependency node outputs (≤300 chars each)
 *     - Tool result references from ToolResultIndex (IDs only, not full output)
 *
 * This ensures no node ever inherits token debt from previous nodes.
 */

import { ReasoningEngine } from '../ai/reasoning/reasoning-engine.js';
import type { ChatContext } from '../ai/reasoning/reasoning-engine.js';
import type { AIProvider, ChatMessage } from '../ai/types.js';
import type { RepoIndex } from '../types/index.js';
import { ExecutionGraph, type ExecutionNode, type NodeResult } from './execution-graph.js';
import { failureAnalyzer } from './failure-analyzer.js';
import { ExecutionStateStore } from '../runtime/execution-state-store.js';
import { ToolResultIndex } from '../runtime/tool-result-index.js';
import { contextBudgetManager } from '../ai/context/context-budget-manager.js';
import { backoffDelayMs, sleep } from './retry-policy.js';
import { LearningLoop } from '../intelligence/learning-loop.js';
import { logger } from '../utils/logger.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default maximum nodes running concurrently. */
const DEFAULT_MAX_PARALLEL = 3;

/** Milliseconds between periodic state saves. */
const SAVE_INTERVAL_MS = 5_000;

/** Max chars from a dependency node's output injected as context. */
const DEP_OUTPUT_SUMMARY_LIMIT = 300;

/** Max LLM rounds per node (unless node.context.maxRounds is set). */
const DEFAULT_MAX_ROUNDS = 15;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SchedulerOptions {
  /** Max nodes executing simultaneously (default: 3). */
  maxParallel?: number;
  /** Called immediately before a node starts. */
  onNodeStart?: (node: ExecutionNode) => void;
  /** Called when a node finishes successfully. */
  onNodeComplete?: (node: ExecutionNode, result: NodeResult) => void;
  /** Called when a node exhausts retries and enters 'failed'. */
  onNodeFailed?: (node: ExecutionNode, error: string) => void;
  /** Called when a node transitions to 'retrying'. */
  onRetry?: (node: ExecutionNode, attempt: number) => void;
  /** Called when a recovery node is dynamically inserted. */
  onRecoveryInserted?: (recoveryNodeId: string, parentId: string) => void;
  /** Streams LLM text chunks from any node. */
  onChunk?: (nodeId: string, chunk: string) => void;
  /** Abort signal — checked between node launches. */
  signal?: AbortSignal;
}

export interface SchedulerResult {
  graphId:    string;
  task:       string;
  completed:  number;
  failed:     number;
  durationMs: number;
  /** IDs of nodes that reached the 'failed' terminal state. */
  failedNodes: string[];
  /** Total tool calls across all nodes. */
  totalToolCalls: number;
  /** Total retry attempts across all nodes (0 when every node succeeded first try). */
  retries: number;
}

// ── GraphScheduler ────────────────────────────────────────────────────────────

export class GraphScheduler {
  private readonly stateStore:      ExecutionStateStore;
  private readonly toolResultIndex: ToolResultIndex;
  private lastSaveTime    = 0;
  private totalToolCalls  = 0;
  private totalRetries    = 0;
  /** Lazily-loaded LearningLoop — null until first retry. */
  private learner: LearningLoop | null = null;
  /**
   * Per-node backoff delays (ms) to apply before the next execution attempt.
   * Set in the failure handler when a node transitions to 'retrying'.
   */
  private readonly pendingBackoffs = new Map<string, number>();

  constructor(
    private readonly provider:    AIProvider,
    private readonly index:       RepoIndex | null,
    private readonly chatContext: ChatContext,
    toolResultIndex?: ToolResultIndex,
  ) {
    this.stateStore      = new ExecutionStateStore(chatContext.rootPath);
    this.toolResultIndex = toolResultIndex ?? new ToolResultIndex();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Execute all nodes in the graph, respecting dependencies and concurrency limits.
   *
   * @param graph - The execution graph to run.
   * @param opts  - Scheduling options and callbacks.
   */
  async run(graph: ExecutionGraph, opts: SchedulerOptions = {}): Promise<SchedulerResult> {
    const start       = Date.now();
    const maxParallel = opts.maxParallel ?? DEFAULT_MAX_PARALLEL;
    const running     = new Map<string, Promise<void>>(); // nodeId → promise

    logger.debug(`[graph-scheduler] ▶ Graph ${graph.graphId}: "${graph.task}" — ${graph.getAllNodes().length} nodes`);
    await this.stateStore.save(graph, 'running');

    while (!graph.isComplete()) {
      if (opts.signal?.aborted) {
        logger.debug('[graph-scheduler] Aborted by signal');
        await this.stateStore.save(graph, 'aborted');
        break;
      }

      const runnable  = graph.getRunnableNodes().filter((n) => !running.has(n.id));
      const freeSlots = maxParallel - running.size;

      if (runnable.length === 0 && running.size === 0) {
        // No progress possible — graph is stuck (all remaining nodes have failed deps)
        logger.warn('[graph-scheduler] Graph stuck — no runnable nodes and nothing running');
        break;
      }

      // Launch new nodes up to the free-slot limit
      const toStart = runnable.slice(0, Math.max(0, freeSlots));

      for (const node of toStart) {
        // Consume any pending backoff registered by a previous failure
        const backoffMs = this.pendingBackoffs.get(node.id) ?? 0;
        this.pendingBackoffs.delete(node.id);

        logger.info(`[graph-scheduler] NODE_START id=${node.id} type=${node.type} role=${node.agentRole}${backoffMs > 0 ? ` backoff=${backoffMs}ms` : ''}`);
        opts.onNodeStart?.(node);
        graph.markRunning(node.id);

        // Delay node launch if a backoff was registered (exponential retry backoff)
        const nodePromise = (backoffMs > 0 ? sleep(backoffMs) : Promise.resolve())
          .then(() => this._executeNode(graph, node, opts))
          .then((result) => {
            graph.markCompleted(node.id, result);
            running.delete(node.id);
            this.totalToolCalls += result.toolCallCount;
            logger.info(`[graph-scheduler] NODE_COMPLETE id=${node.id} duration=${result.durationMs}ms tools=${result.toolCallCount}`);
            opts.onNodeComplete?.(node, result);
            void this._maybeSave(graph);
          })
          .catch((err: Error) => {
            const msg = err.message;
            graph.markFailed(node.id, msg);
            running.delete(node.id);

            if (node.state === 'retrying') {
              // Register exponential backoff for the next attempt
              const delay = backoffDelayMs(node.retryCount);
              this.pendingBackoffs.set(node.id, delay);
              this.totalRetries++;
              logger.info(`[graph-scheduler] RETRY id=${node.id} attempt=${node.retryCount} backoff=${delay}ms error="${msg.slice(0, 80)}"`);
              opts.onRetry?.(node, node.retryCount);
            } else {
              // Terminal failure — state = 'failed'
              logger.warn(`[graph-scheduler] NODE_FAILED id=${node.id} error="${msg.slice(0, 120)}"`);
              opts.onNodeFailed?.(node, msg);
              // Insert recovery node for classifiable failures
              const recoveryId = this._insertRecoveryNode(graph, node, msg);
              if (recoveryId) opts.onRecoveryInserted?.(recoveryId, node.id);
            }

            void this._maybeSave(graph);
          });

        running.set(node.id, nodePromise);
      }

      if (running.size > 0) {
        // Wait for the first running node to finish before re-evaluating
        await Promise.race(running.values());
      } else {
        // Nothing running and nothing launchable — break to avoid busy loop
        break;
      }
    }

    const finalStatus = graph.hasFailures() ? 'failed' : 'completed';
    await this.stateStore.save(graph, finalStatus);

    const stats  = graph.getStats();
    const result: SchedulerResult = {
      graphId:        graph.graphId,
      task:           graph.task,
      completed:      stats.completed,
      failed:         stats.failed,
      durationMs:     Date.now() - start,
      failedNodes:    graph.getAllNodes().filter((n) => n.state === 'failed').map((n) => n.id),
      totalToolCalls: this.totalToolCalls,
      retries:        this.totalRetries,
    };

    logger.info(
      `[graph-scheduler] GRAPH_DONE id=${graph.graphId} ` +
      `completed=${stats.completed} failed=${stats.failed} ` +
      `retries=${this.totalRetries} duration=${(result.durationMs / 1000).toFixed(1)}s ` +
      `tools=${this.totalToolCalls}`,
    );

    return result;
  }

  // ── Private: node execution ────────────────────────────────────────────────

  /**
   * Execute a single node with a fresh ReasoningEngine instance and empty history.
   *
   * Context isolation: the engine receives [] as conversation history.
   * All context is injected through the prompt string only.
   */
  private async _executeNode(
    graph: ExecutionGraph,
    node:  ExecutionNode,
    opts:  SchedulerOptions,
  ): Promise<NodeResult> {
    const stepStart    = Date.now();
    const engine       = new ReasoningEngine(this.index, this.provider);
    const localHistory: ChatMessage[] = []; // ← ISOLATED — intentionally empty

    let   output         = '';
    let   toolCallCount  = 0;
    const filesModified: string[] = [];

    // Load learning data lazily (only needed for retry nodes)
    if (node.retryCount > 0) await this._loadLearner();

    // Build the isolated node prompt
    const prompt = this._buildNodePrompt(graph, node);

    logger.debug(`[graph-scheduler] Node "${node.id}" prompt length: ${prompt.length} chars`);

    await engine.chat(
      prompt,
      this.chatContext,
      localHistory,
      (chunk) => {
        output += chunk;
        opts.onChunk?.(node.id, chunk);
      },
      (stage) => {
        // Track file writes from stage messages
        if (stage.startsWith('WRITE ')) {
          const token = stage.slice(6).split(/\s+/)[0];
          if (token && !token.startsWith('(')) filesModified.push(token);
        }
        // Store tool results in ToolResultIndex (from stage messages if encoded)
        if (stage.startsWith('TOOL_RESULT ')) {
          const parts = stage.slice(12).split(' ', 2);
          if (parts.length === 2) {
            this.toolResultIndex.store(node.id, parts[0], {}, parts[1]);
          }
        }
      },
      undefined, // onPlan
      undefined, // onContext
      (toolName) => {
        toolCallCount++;
        // Store a lightweight reference for the tool call
        this.toolResultIndex.store(node.id, toolName, {}, `[called by ${node.id}]`);
      },
      opts.signal,
      {
        maxRounds:        node.context.maxRounds ?? DEFAULT_MAX_ROUNDS,
        skipRetrieval:    !!node.context.repoContext,
        retrievalContext: node.context.repoContext ?? '',
        // Graph nodes are already the output of the planning phase —
        // suppress the redundant in-chat planning LLM call to save tokens.
        skipPlanning:     true,
      },
    );

    return {
      output,
      filesModified,
      toolCallCount,
      durationMs: Date.now() - stepStart,
    };
  }

  // ── Private: prompt building ───────────────────────────────────────────────

  /**
   * Build a compact, self-contained prompt for a node.
   *
   * The prompt contains:
   *   1. Role and task description
   *   2. Graph metadata (goal + node position)
   *   3. Summaries from completed dependencies (≤300 chars each)
   *   4. ToolResultIndex references for this node
   *   5. Retry context (if applicable)
   *   6. Context safety header (MAX_CONTEXT instruction)
   */
  private _buildNodePrompt(graph: ExecutionGraph, node: ExecutionNode): string {
    const lines: string[] = [];

    // ── Header ──────────────────────────────────────────────────────────────
    lines.push(`## Task for ${node.agentRole}`);
    lines.push('');
    lines.push(node.description);
    lines.push('');
    lines.push(`Context: node "${node.id}" (${node.type}) in graph "${graph.graphId}"`);
    lines.push(`Overall goal: ${graph.task}`);
    lines.push('Focus exclusively on this task. Do not duplicate work assigned to other nodes.');

    // ── Dependency summaries ─────────────────────────────────────────────────
    const completedDeps = node.dependsOn
      .map((depId) => graph.getNode(depId))
      .filter((dep): dep is ExecutionNode => dep?.state === 'completed');

    if (completedDeps.length > 0) {
      lines.push('');
      lines.push('## Results from prerequisite nodes:');
      for (const dep of completedDeps) {
        const summary = dep.result?.output?.slice(0, DEP_OUTPUT_SUMMARY_LIMIT) ?? '(no output)';
        lines.push(`- **${dep.id}** (${dep.type}): ${summary}${dep.result && dep.result.output.length > DEP_OUTPUT_SUMMARY_LIMIT ? '…' : ''}`);
        if (dep.result?.filesModified && dep.result.filesModified.length > 0) {
          lines.push(`  Files modified: ${dep.result.filesModified.join(', ')}`);
        }
      }
    }

    // ── Tool result references ───────────────────────────────────────────────
    const refs = this.toolResultIndex.query({ nodeId: node.id, limit: 8 });
    if (refs.length > 0) {
      lines.push('');
      lines.push('## Available tool result references (this node):');
      for (const r of refs) {
        const desc = buildDescription(r.tool, r.args, r.output);
        lines.push(`- ${r.id}: ${desc}`);
      }
      lines.push('To access a full result, reference its ID in your reasoning or request it explicitly.');
    }

    // ── Repository context ───────────────────────────────────────────────────
    if (node.context.repoContext) {
      lines.push('');
      lines.push('## Repository context:');
      lines.push(node.context.repoContext.slice(0, 1_500));
    }

    // ── Retry context ────────────────────────────────────────────────────────
    if (node.retryCount > 0 && node.error) {
      const analysis  = failureAnalyzer.classify(node.error);
      const strategy  = this._getAlternativeStrategy(analysis.type);
      lines.push('');
      lines.push(`## Retry attempt ${node.retryCount} (${analysis.type})`);
      lines.push('Previous attempt failed with:');
      lines.push(node.error.slice(0, 500));
      lines.push('');
      lines.push(`**Alternative strategy for this retry:** ${strategy}`);
      // Inject LearningLoop hint if available
      const learnHint = this.learner?.formatHint(analysis.type);
      if (learnHint) lines.push(learnHint);
      lines.push('Do not repeat the same approach — apply the strategy above.');
    }

    // ── Context safety footer ────────────────────────────────────────────────
    lines.push('');
    lines.push('## Context safety');
    lines.push('Keep your response concise. Use tool references instead of quoting large file contents inline.');

    return lines.join('\n');
  }

  // ── Private: intelligent retry strategy ───────────────────────────────────

  /**
   * Return a targeted strategy hint for a retry attempt, based on failure type.
   * Prefers historically-successful strategies from LearningLoop when available;
   * falls back to hardcoded defaults otherwise.
   */
  private _getAlternativeStrategy(failureType: string): string {
    // Check LearningLoop for empirically-validated strategies
    const learned = this.learner?.getBestStrategy(failureType);
    if (learned) return `[Learned strategy — ${Math.round((this.learner!.getStrategies(failureType)[0]?.winRate ?? 0) * 100)}% success rate] ${learned}`;

    switch (failureType) {
      case 'compile_error':
        return 'Run `tsc --noEmit` first to get the full error list, then fix each error individually before writing any code.';
      case 'missing_dep':
        return 'Use grep_code to confirm the exact export name and file path before importing. Check package.json for available packages.';
      case 'test_failure':
        return 'Read the test file carefully to understand expected behavior, then fix the implementation rather than the tests.';
      case 'runtime_error':
        return 'Add null/undefined guards before accessing nested properties. Read the stack trace to identify the exact line.';
      case 'logic_bug':
        return 'Re-read ALL files modified in the previous attempt. Trace the data flow from input to output to find the incorrect assumption.';
      default:
        return 'Start by re-reading the relevant files to get a fresh understanding before making any changes.';
    }
  }

  /** Load the LearningLoop lazily (only when a retry is needed). */
  private async _loadLearner(): Promise<void> {
    if (this.learner) return;
    try {
      this.learner = await LearningLoop.load(this.chatContext.rootPath);
    } catch {
      // non-fatal — learning is optional
    }
  }

  // ── Private: recovery ─────────────────────────────────────────────────────

  /**
   * Classify the failure and, if classifiable, insert a recovery node into the graph.
   *
   * Returns the recovery node ID if inserted, null otherwise.
   */
  private _insertRecoveryNode(
    graph:      ExecutionGraph,
    failedNode: ExecutionNode,
    error:      string,
  ): string | null {
    const analysis = failureAnalyzer.classify(error);
    if (analysis.type === 'unknown') return null;

    const recoveryId = `${failedNode.id}_fix_${Date.now().toString(36)}`;
    const recovery: ExecutionNode = {
      id:          recoveryId,
      type:        'fix',
      agentRole:   failedNode.agentRole,
      description: analysis.fixPrompt,
      dependsOn:   [...failedNode.dependsOn],
      state:       'pending',
      context: {
        task:       analysis.fixPrompt,
        repoContext: failedNode.context.repoContext,
        maxRounds:  10,
      },
      retryCount: 0,
      maxRetries: 1,
      priority:   failedNode.priority + 10, // run before normal nodes
      isDynamic:  true,
    };

    graph.insertRecoveryNode(failedNode.id, recovery);
    logger.debug(`[graph-scheduler] Inserted recovery node "${recoveryId}" for "${failedNode.id}" (${analysis.type})`);

    return recoveryId;
  }

  // ── Private: persistence ───────────────────────────────────────────────────

  private async _maybeSave(graph: ExecutionGraph): Promise<void> {
    const now = Date.now();
    if (now - this.lastSaveTime >= SAVE_INTERVAL_MS) {
      this.lastSaveTime = now;
      await this.stateStore.save(graph, 'running');
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDescription(
  tool: string,
  args: Record<string, string>,
  output: string,
): string {
  const lines    = output.split('\n').length;
  const firstArg = Object.values(args)[0] ?? '';
  return firstArg
    ? `${tool}: ${firstArg} (${lines} lines)`
    : `${tool} (${lines} lines)`;
}
