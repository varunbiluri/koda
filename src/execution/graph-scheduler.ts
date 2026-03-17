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
}

// ── GraphScheduler ────────────────────────────────────────────────────────────

export class GraphScheduler {
  private readonly stateStore:      ExecutionStateStore;
  private readonly toolResultIndex: ToolResultIndex;
  private lastSaveTime = 0;
  private totalToolCalls = 0;

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
        logger.debug(`[graph-scheduler] ▷ Node start: ${node.id} (${node.type}/${node.agentRole})`);
        opts.onNodeStart?.(node);
        graph.markRunning(node.id);

        const nodePromise = this._executeNode(graph, node, opts)
          .then((result) => {
            graph.markCompleted(node.id, result);
            running.delete(node.id);
            this.totalToolCalls += result.toolCallCount;
            logger.debug(`[graph-scheduler] ✓ Node complete: ${node.id} (${result.durationMs}ms, ${result.toolCallCount} tools)`);
            opts.onNodeComplete?.(node, result);
            void this._maybeSave(graph);
          })
          .catch((err: Error) => {
            const msg = err.message;
            graph.markFailed(node.id, msg);
            running.delete(node.id);

            if (node.state === 'retrying') {
              logger.debug(`[graph-scheduler] ↻ Node retry: ${node.id} (attempt ${node.retryCount})`);
              opts.onRetry?.(node, node.retryCount);
            } else {
              // state = 'failed'
              logger.warn(`[graph-scheduler] ✗ Node failed: ${node.id} — ${msg.slice(0, 120)}`);
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
    };

    logger.debug(
      `[graph-scheduler] ■ Graph done: ${stats.completed} completed, ` +
      `${stats.failed} failed, ${(result.durationMs / 1000).toFixed(1)}s, ` +
      `${this.totalToolCalls} total tool calls`,
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
      lines.push('');
      lines.push(`## Retry attempt ${node.retryCount}`);
      lines.push('Previous attempt failed with:');
      lines.push(node.error.slice(0, 500));
      lines.push('Do not repeat the same approach — try a different strategy.');
    }

    // ── Context safety footer ────────────────────────────────────────────────
    lines.push('');
    lines.push('## Context safety');
    lines.push('Keep your response concise. Use tool references instead of quoting large file contents inline.');

    return lines.join('\n');
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
