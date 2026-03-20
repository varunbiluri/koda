/**
 * ExecutionGraph — core data model for the Task Execution Graph (TEG).
 *
 * Replaces the linear plan-step list with a Directed Acyclic Graph (DAG)
 * where each node has:
 *   - isolated context and token budget
 *   - explicit dependency edges
 *   - a state machine (pending → running → completed | failed | retrying)
 *   - independent retry semantics
 *   - a serializable result for persistence and debugging
 *
 * Example graph for "implement JWT auth with tests":
 *
 *   explore_repo ──▶ analyze_deps ──▶ implement_auth ──▶ run_tests ──▶ verify
 *                                  ╰──▶ update_config ──╯
 *
 * Independent nodes (analyze_deps and nothing else) can run in parallel.
 * Failed nodes generate recovery nodes that are inserted before dependents.
 */

import { logger } from '../utils/logger.js';

// ── Enumerations ──────────────────────────────────────────────────────────────

export type NodeState =
  | 'pending'    // waiting for dependencies
  | 'running'    // currently executing
  | 'completed'  // finished successfully
  | 'failed'     // exhausted retries
  | 'retrying'   // failed but will retry
  | 'skipped';   // intentionally bypassed

export type NodeType =
  | 'explore'    // repository exploration (read-only)
  | 'analyze'    // code/dependency analysis (read-only)
  | 'implement'  // code writing / editing
  | 'test'       // running tests
  | 'verify'     // build + lint + type-check
  | 'fix'        // error recovery (dynamically inserted)
  | 'document'   // documentation generation
  | 'refactor'   // code quality improvement
  | 'security'   // security scan / hardening
  | 'custom';    // user-defined

export type AgentRole =
  | 'CodingAgent'
  | 'TestAgent'
  | 'RefactorAgent'
  | 'SecurityAgent'
  | 'DocsAgent'
  | 'ExplorerAgent'
  | 'AnalysisAgent'
  | 'VerificationAgent';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Per-node execution context.
 *
 * Each node carries its own minimal context instead of inheriting the full
 * conversation history. This is the primary mechanism for context isolation.
 */
export interface NodeContext {
  /** The specific task for this node (one sentence, actionable). */
  task: string;
  /** Compact repository summary injected as background for this node only. */
  repoContext?: string;
  /** IDs of ToolResultIndex entries relevant to this node (out-of-band refs). */
  toolResultRefs?: string[];
  /** Max LLM rounds for this node (default: 15). */
  maxRounds?: number;
  /** Max tokens for this node's context window (default: 60 000). */
  maxTokens?: number;
}

/** Result produced by a completed node. */
export interface NodeResult {
  /** LLM text output from the node's reasoning loop. */
  output: string;
  /** Files written or edited during this node. */
  filesModified: string[];
  /** Total tool calls made by this node. */
  toolCallCount: number;
  /** Wall clock duration in milliseconds. */
  durationMs: number;
  /** Error message if the node ended with an exception (still completed). */
  error?: string;
}

/** A single vertex in the ExecutionGraph. */
export interface ExecutionNode {
  /** Unique identifier within the graph (e.g. "implement_auth"). */
  id: string;
  /** Semantic type drives agent selection and retry strategy. */
  type: NodeType;
  /** Which worker agent runs this node. */
  agentRole: AgentRole;
  /** Human-readable description of what this node must accomplish. */
  description: string;
  /** IDs of nodes that must reach 'completed' before this node can run. */
  dependsOn: string[];
  /** Current lifecycle state. */
  state: NodeState;
  /** Isolated context for this node's LLM calls. */
  context: NodeContext;
  /** Populated when state = 'completed'. */
  result?: NodeResult;
  /** How many times this node has been retried (0 = first attempt). */
  retryCount: number;
  /** Maximum retries before state transitions to 'failed'. */
  maxRetries: number;
  /** Higher priority nodes run first among equally-ready candidates. */
  priority: number;
  /** Unix ms when the node entered 'running'. */
  startedAt?: number;
  /** Unix ms when the node entered 'completed' or 'failed'. */
  completedAt?: number;
  /** Last error message — populated on failure / retry. */
  error?: string;
  /** True when the node was inserted dynamically (e.g. recovery node). */
  isDynamic?: boolean;
}

/** Aggregate counts across all nodes in the graph. */
export interface GraphStats {
  total:     number;
  pending:   number;
  running:   number;
  completed: number;
  failed:    number;
  retrying:  number;
  skipped:   number;
}

// ── ExecutionGraph ────────────────────────────────────────────────────────────

/**
 * Directed Acyclic Graph of ExecutionNodes.
 *
 * Provides:
 *   - O(1) node lookup
 *   - Dependency-aware runnable-node querying
 *   - State transition helpers
 *   - Dynamic recovery-node insertion
 *   - JSON serialization for persistence
 */
export class ExecutionGraph {
  readonly graphId:   string;
  readonly task:      string;
  readonly createdAt: number;

  private readonly nodes: Map<string, ExecutionNode> = new Map();

  constructor(task: string, graphId?: string) {
    this.task      = task;
    this.graphId   = graphId ?? `graph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.createdAt = Date.now();
  }

  // ── Mutation ───────────────────────────────────────────────────────────────

  /** Add a node. Throws if the id is already registered or if adding the node creates a cycle. */
  addNode(node: ExecutionNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`[execution-graph] Duplicate node id: "${node.id}"`);
    }
    // Validate dependency references
    for (const dep of node.dependsOn) {
      if (!this.nodes.has(dep)) {
        logger.warn(`[execution-graph] Node "${node.id}" depends on unknown node "${dep}"`);
      }
    }
    // Tentatively insert, then verify no cycle was introduced
    this.nodes.set(node.id, node);
    const cycle = this._detectCycle();
    if (cycle) {
      this.nodes.delete(node.id); // roll back
      throw new Error(`[execution-graph] Adding node "${node.id}" creates a cycle: ${cycle}`);
    }
  }

  /** Transition a node to 'running'. */
  markRunning(id: string): void {
    const node = this._require(id);
    node.state     = 'running';
    node.startedAt = Date.now();
  }

  /** Transition a node to 'completed' and attach its result. */
  markCompleted(id: string, result: NodeResult): void {
    const node = this._require(id);
    node.state       = 'completed';
    node.result      = result;
    node.completedAt = Date.now();
  }

  /**
   * Transition a node to 'retrying' or 'failed'.
   *
   * If retryCount < maxRetries: increments retryCount, sets state = 'retrying'.
   * Otherwise: sets state = 'failed' and records completedAt.
   */
  markFailed(id: string, error: string): void {
    const node = this._require(id);
    node.error = error;
    if (node.retryCount < node.maxRetries) {
      node.state = 'retrying';
      node.retryCount++;
      logger.debug(`[execution-graph] Node "${id}" retry ${node.retryCount}/${node.maxRetries}`);
    } else {
      node.state       = 'failed';
      node.completedAt = Date.now();
    }
  }

  /** Mark a node as skipped (will not be executed). */
  markSkipped(id: string): void {
    const node = this._require(id);
    node.state       = 'skipped';
    node.completedAt = Date.now();
  }

  /**
   * Insert a dynamically-created recovery node into the graph.
   *
   * All pending nodes that depended on `afterId` are re-wired to depend on
   * `recoveryNode.id` instead, ensuring the recovery step runs first.
   */
  insertRecoveryNode(afterId: string, recoveryNode: ExecutionNode): void {
    recoveryNode.isDynamic = true;
    // Re-wire pending dependents
    for (const node of this.nodes.values()) {
      if (
        node.state === 'pending' &&
        node.id    !== recoveryNode.id &&
        node.dependsOn.includes(afterId)
      ) {
        node.dependsOn = node.dependsOn.map((d) => (d === afterId ? recoveryNode.id : d));
      }
    }
    this.nodes.set(recoveryNode.id, recoveryNode);
    logger.debug(`[execution-graph] Recovery node "${recoveryNode.id}" inserted after "${afterId}"`);
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  getNode(id: string): ExecutionNode | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): ExecutionNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Return nodes whose dependencies are all 'completed' and whose own state
   * is 'pending' or 'retrying', sorted by descending priority.
   */
  getRunnableNodes(): ExecutionNode[] {
    return Array.from(this.nodes.values())
      .filter((node) => {
        if (node.state !== 'pending' && node.state !== 'retrying') return false;
        return node.dependsOn.every((depId) => {
          const dep = this.nodes.get(depId);
          return dep?.state === 'completed' || dep?.state === 'skipped';
        });
      })
      .sort((a, b) => b.priority - a.priority);
  }

  /** True when every node has reached a terminal state. */
  isComplete(): boolean {
    return Array.from(this.nodes.values()).every(
      (n) => n.state === 'completed' || n.state === 'failed' || n.state === 'skipped',
    );
  }

  /** True when at least one node is in the 'failed' terminal state. */
  hasFailures(): boolean {
    return Array.from(this.nodes.values()).some((n) => n.state === 'failed');
  }

  /** Aggregate node counts by state. */
  getStats(): GraphStats {
    const all = Array.from(this.nodes.values());
    return {
      total:     all.length,
      pending:   all.filter((n) => n.state === 'pending').length,
      running:   all.filter((n) => n.state === 'running').length,
      completed: all.filter((n) => n.state === 'completed').length,
      failed:    all.filter((n) => n.state === 'failed').length,
      retrying:  all.filter((n) => n.state === 'retrying').length,
      skipped:   all.filter((n) => n.state === 'skipped').length,
    };
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  toJSON(): GraphJSON {
    return {
      graphId:   this.graphId,
      task:      this.task,
      createdAt: this.createdAt,
      nodes:     Array.from(this.nodes.values()),
    };
  }

  static fromJSON(data: GraphJSON): ExecutionGraph {
    const graph = new ExecutionGraph(data.task, data.graphId);
    // Bypass addNode validation — restoring a persisted state
    for (const node of data.nodes) {
      graph.nodes.set(node.id, node);
    }
    return graph;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * DFS-based cycle detection over the current node set.
   * Returns a human-readable cycle description string if a cycle exists, null if the graph is a DAG.
   *
   * Algorithm: colour each node white (unvisited) → grey (in current DFS stack) → black (done).
   * A back-edge to a grey node signals a cycle.
   */
  private _detectCycle(): string | null {
    const WHITE = 0, GREY = 1, BLACK = 2;
    const colour = new Map<string, number>();
    for (const id of this.nodes.keys()) colour.set(id, WHITE);

    const dfs = (id: string, path: string[]): string | null => {
      colour.set(id, GREY);
      const node = this.nodes.get(id);
      for (const dep of node?.dependsOn ?? []) {
        const c = colour.get(dep) ?? WHITE;
        if (c === GREY) {
          return [...path, id, dep].join(' → ');
        }
        if (c === WHITE) {
          const result = dfs(dep, [...path, id]);
          if (result) return result;
        }
      }
      colour.set(id, BLACK);
      return null;
    };

    for (const id of this.nodes.keys()) {
      if ((colour.get(id) ?? WHITE) === WHITE) {
        const cycle = dfs(id, []);
        if (cycle) return cycle;
      }
    }
    return null;
  }

  private _require(id: string): ExecutionNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`[execution-graph] Node not found: "${id}"`);
    return node;
  }
}

/** Shape of the JSON produced by ExecutionGraph.toJSON(). */
export interface GraphJSON {
  graphId:   string;
  task:      string;
  createdAt: number;
  nodes:     ExecutionNode[];
}
