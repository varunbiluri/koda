/**
 * TaskGraphBuilder — converts a high-level task into an ExecutionGraph (DAG).
 *
 * Pipeline:
 *   1. Single LLM call at temperature 0.1 → structured node list
 *   2. Parse node list → ExecutionNode[]
 *   3. Validate dependencies + detect cycles
 *   4. Return a ready-to-schedule ExecutionGraph
 *
 * LLM output format (each line = one node):
 *
 *   NODE explore_repo    | type=explore    | agent=ExplorerAgent      | deps=          | priority=10 | desc=Explore the repository structure
 *   NODE analyze_deps    | type=analyze    | agent=AnalysisAgent      | deps=explore_repo | priority=9 | desc=Analyze module dependencies
 *   NODE implement_feat  | type=implement  | agent=CodingAgent        | deps=analyze_deps | priority=8 | desc=Implement the JWT auth middleware
 *   NODE update_config   | type=implement  | agent=CodingAgent        | deps=analyze_deps | priority=8 | desc=Update the environment config
 *   NODE run_tests       | type=test       | agent=TestAgent          | deps=implement_feat,update_config | priority=7 | desc=Run all tests and fix failures
 *   NODE verify          | type=verify     | agent=VerificationAgent  | deps=run_tests    | priority=6 | desc=Build verification and type check
 *
 * Fallback: when LLM fails, a deterministic 4-node default graph is returned.
 */

import type { AIProvider } from '../ai/types.js';
import {
  ExecutionGraph,
  type ExecutionNode,
  type NodeType,
  type AgentRole,
  type NodeContext,
} from '../execution/execution-graph.js';
import { logger } from '../utils/logger.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_NODES            = 12;
const BUILDER_TEMPERATURE  = 0.1;
const BUILDER_MAX_TOKENS   = 600;

// ── System prompt ─────────────────────────────────────────────────────────────

const GRAPH_BUILDER_SYSTEM = [
  'You are a task decomposition engine for an AI software engineer named Koda.',
  'Convert a task into a Directed Acyclic Graph (DAG) of execution nodes.',
  '',
  'Output rules:',
  `- Output EXACTLY ${MAX_NODES} or fewer nodes`,
  '- Each line: "NODE <id> | type=<type> | agent=<agent> | deps=<comma-list-or-empty> | priority=<1-10> | desc=<one-line description>"',
  '- ids: snake_case, unique, descriptive (e.g. explore_repo, implement_auth)',
  '- type: explore | analyze | implement | test | verify | document | refactor | security | custom',
  '- agent: ExplorerAgent | AnalysisAgent | CodingAgent | TestAgent | RefactorAgent | SecurityAgent | DocsAgent | VerificationAgent',
  '- deps: comma-separated node ids that must complete first, or empty',
  '- priority: 1 (low) to 10 (high) — higher priority nodes run first when equally ready',
  '- desc: one-line task description for that node',
  '',
  'Ordering rules:',
  '- Always start with an explore or analyze node (deps=empty)',
  '- Implementation nodes depend on analysis nodes',
  '- Test nodes depend on implementation nodes',
  '- Verify nodes depend on test nodes',
  '- Independent nodes (no shared deps) can run in parallel — use this for speed',
  '',
  'No preamble, no explanation, no markdown — only NODE lines.',
].join('\n');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Maps type string from LLM to the NodeType union. */
function parseNodeType(raw: string): NodeType {
  const valid: NodeType[] = [
    'explore', 'analyze', 'implement', 'test', 'verify',
    'fix', 'document', 'refactor', 'security', 'custom',
  ];
  const t = raw.trim().toLowerCase() as NodeType;
  return valid.includes(t) ? t : 'custom';
}

/** Maps agent string from LLM to the AgentRole union. */
function parseAgentRole(raw: string): AgentRole {
  const map: Record<string, AgentRole> = {
    exploreragent:      'ExplorerAgent',
    analysisagent:      'AnalysisAgent',
    codingagent:        'CodingAgent',
    testagent:          'TestAgent',
    refactoragent:      'RefactorAgent',
    securityagent:      'SecurityAgent',
    docsagent:          'DocsAgent',
    verificationagent:  'VerificationAgent',
  };
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  return map[key] ?? 'CodingAgent';
}

/**
 * Parse a single "NODE ..." line.
 * Returns null for malformed lines.
 */
function parseLine(line: string, repoContext?: string): ExecutionNode | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('NODE ')) return null;

  // Split by pipe, trim each part
  const parts = trimmed.slice(5).split('|').map((p) => p.trim());
  if (parts.length < 5) return null;

  // First part is the id
  const id = parts[0].trim();
  if (!id || !/^\w[\w-]*$/.test(id)) return null;

  const fields: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) continue;
    const key = part.slice(0, eqIdx).trim().toLowerCase();
    const val = part.slice(eqIdx + 1).trim();
    fields[key] = val;
  }

  const type      = parseNodeType(fields['type']    ?? 'custom');
  const agentRole = parseAgentRole(fields['agent']   ?? 'CodingAgent');
  const depsRaw   = (fields['deps'] ?? '').split(',').map((d) => d.trim()).filter(Boolean);
  const priority  = Math.min(10, Math.max(1, parseInt(fields['priority'] ?? '5', 10)));
  const desc      = fields['desc'] ?? `Execute ${id}`;

  const context: NodeContext = {
    task:        desc,
    repoContext: repoContext,
    maxRounds:   type === 'explore' || type === 'analyze' ? 8 : 15,
  };

  return {
    id,
    type,
    agentRole,
    description: desc,
    dependsOn:   depsRaw,
    state:       'pending',
    context,
    retryCount:  0,
    maxRetries:  type === 'verify' ? 1 : 2,
    priority,
  };
}

/**
 * Detect a dependency cycle using DFS.
 * Returns the cycle description string if found, null otherwise.
 */
function detectCycle(nodes: ExecutionNode[]): string | null {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const stack   = new Set<string>();

  function dfs(id: string): string | null {
    if (stack.has(id)) return id;
    if (visited.has(id)) return null;

    visited.add(id);
    stack.add(id);

    const node = nodeMap.get(id);
    for (const dep of node?.dependsOn ?? []) {
      const cycle = dfs(dep);
      if (cycle) return `${id} → ${cycle}`;
    }

    stack.delete(id);
    return null;
  }

  for (const node of nodes) {
    const cycle = dfs(node.id);
    if (cycle) return cycle;
  }

  return null;
}

// ── Default fallback graph ────────────────────────────────────────────────────

function buildDefaultGraph(task: string, repoContext?: string): ExecutionGraph {
  const graph = new ExecutionGraph(task);
  const mkNode = (
    id:        string,
    type:      NodeType,
    agentRole: AgentRole,
    desc:      string,
    deps:      string[],
    priority:  number,
  ): ExecutionNode => ({
    id, type, agentRole,
    description: desc,
    dependsOn:   deps,
    state:       'pending',
    context:     { task: desc, repoContext, maxRounds: type === 'explore' ? 8 : 15 },
    retryCount:  0,
    maxRetries:  2,
    priority,
  });

  graph.addNode(mkNode('explore_repo',   'explore',   'ExplorerAgent',   `Explore the repository structure for: ${task}`,       [],               10));
  graph.addNode(mkNode('implement_task', 'implement', 'CodingAgent',     `Implement: ${task}`,                                  ['explore_repo'], 8));
  graph.addNode(mkNode('run_tests',      'test',      'TestAgent',       'Run tests and fix any failures',                      ['implement_task'], 6));
  graph.addNode(mkNode('verify',         'verify',    'VerificationAgent', 'Run build + lint + type check verification',        ['run_tests'],    4));

  logger.debug('[task-graph-builder] Using default 4-node fallback graph');
  return graph;
}

// ── TaskGraphBuilder ──────────────────────────────────────────────────────────

/**
 * Converts a high-level task description into an ExecutionGraph.
 *
 * Usage:
 * ```ts
 * const builder = new TaskGraphBuilder(provider);
 * const graph   = await builder.build('Add JWT authentication with tests', repoCtx);
 * const result  = await scheduler.run(graph);
 * ```
 */
export class TaskGraphBuilder {
  constructor(private readonly provider: AIProvider) {}

  /**
   * Build an ExecutionGraph for the given task.
   *
   * @param task       - Human-readable task description.
   * @param repoContext - Optional compact repository context (architecture summary).
   */
  async build(task: string, repoContext?: string): Promise<ExecutionGraph> {
    logger.debug(`[task-graph-builder] Building graph for: "${task.slice(0, 80)}"`);

    let rawText = '';

    try {
      const ctxBlock = repoContext
        ? `\nRepository context:\n${repoContext.slice(0, 1_500)}\n`
        : '';

      const response = await this.provider.sendChatCompletion({
        messages: [
          { role: 'system', content: GRAPH_BUILDER_SYSTEM },
          { role: 'user',   content: `${ctxBlock}\nTask: ${task}\n\nGenerate the execution graph:` },
        ],
        temperature: BUILDER_TEMPERATURE,
        max_tokens:  BUILDER_MAX_TOKENS,
      });

      rawText = response.choices[0]?.message?.content ?? '';
    } catch (err) {
      logger.warn(`[task-graph-builder] LLM call failed — using fallback graph: ${(err as Error).message}`);
      return buildDefaultGraph(task, repoContext);
    }

    // ── Parse ──────────────────────────────────────────────────────────────

    const nodes: ExecutionNode[] = [];
    const seenIds = new Set<string>();

    for (const line of rawText.split('\n')) {
      if (nodes.length >= MAX_NODES) break;

      const node = parseLine(line, repoContext);
      if (!node) continue;
      if (seenIds.has(node.id)) {
        logger.warn(`[task-graph-builder] Duplicate node id "${node.id}" — skipping`);
        continue;
      }

      seenIds.add(node.id);
      nodes.push(node);
    }

    if (nodes.length === 0) {
      logger.warn('[task-graph-builder] No valid nodes parsed — using fallback graph');
      return buildDefaultGraph(task, repoContext);
    }

    // ── Validate dependencies ──────────────────────────────────────────────

    // Remove references to unknown node ids
    for (const node of nodes) {
      const badDeps = node.dependsOn.filter((d) => !seenIds.has(d));
      if (badDeps.length > 0) {
        logger.warn(`[task-graph-builder] Node "${node.id}" has unknown deps: ${badDeps.join(', ')} — removing`);
        node.dependsOn = node.dependsOn.filter((d) => seenIds.has(d));
      }
    }

    // ── Cycle detection ────────────────────────────────────────────────────

    const cycle = detectCycle(nodes);
    if (cycle) {
      logger.warn(`[task-graph-builder] Cycle detected: ${cycle} — using fallback graph`);
      return buildDefaultGraph(task, repoContext);
    }

    // ── Assemble graph ────────────────────────────────────────────────────

    const graph = new ExecutionGraph(task);
    for (const node of nodes) {
      graph.addNode(node);
    }

    logger.debug(`[task-graph-builder] Graph built: ${nodes.length} nodes`);
    return graph;
  }

  /**
   * Build a graph from a manually-specified node list (no LLM call).
   *
   * Useful for programmatic construction and testing.
   */
  buildFromNodes(task: string, nodes: ExecutionNode[]): ExecutionGraph {
    const cycle = detectCycle(nodes);
    if (cycle) throw new Error(`[task-graph-builder] Cycle in provided nodes: ${cycle}`);

    const graph = new ExecutionGraph(task);
    for (const node of nodes) graph.addNode(node);
    return graph;
  }
}
