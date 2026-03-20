/**
 * ToolResultIndex — out-of-band storage for tool outputs.
 *
 * In the TEG runtime, tool outputs are NOT injected inline into the LLM
 * message history. Instead, they are stored here and referenced by a short
 * ID ("result_42"). The LLM receives only a compact reference line:
 *
 *   result_42: read_file src/auth/auth-service.ts (142 lines)
 *
 * Benefits:
 *   - Context window never grows from tool output accumulation
 *   - Outputs persist across node boundaries and can be queried
 *   - LLM can request specific results rather than receiving everything
 *   - Full outputs available for debugging / state persistence
 *
 * Usage:
 * ```ts
 * const ref = toolResultIndex.store(nodeId, 'read_file', { path: 'src/auth.ts' }, content);
 * // ref.id === "result_42"
 * const output = toolResultIndex.getOutput('result_42');
 * const refs   = toolResultIndex.buildContextRefs(['result_42', 'result_43']);
 * // → "result_42: read_file: src/auth.ts (87 lines)\nresult_43: run_terminal (12 lines)"
 * ```
 */

import { logger } from '../utils/logger.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max characters stored per result. Larger outputs are truncated with a marker. */
const MAX_RESULT_SIZE = 8_000;

/** Max number of characters in a reference description line. */
const REF_DESCRIPTION_LIMIT = 120;

/** Maximum result entries retained in memory before evicting the oldest. */
const MAX_RESULTS = 200;

/**
 * How long (ms) a stored result is eligible for reuse.
 * After this TTL a cache hit is rejected — the on-disk file may have changed.
 * Set to 10 minutes: safe for a single interactive session; short enough that
 * a file write followed by a re-read within the same session gets fresh data.
 */
const REUSE_TTL_MS = 10 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ToolResult {
  /** Reference ID, e.g. "result_42". */
  id: string;
  /** Graph node that produced this result. */
  nodeId: string;
  /** Name of the tool that was called. */
  tool: string;
  /** Arguments the tool was called with. */
  args: Record<string, string>;
  /** Full raw output (may be large). */
  output: string;
  /** Truncated version for LLM injection, or undefined when output is small enough. */
  truncatedOutput?: string;
  /** Unix ms timestamp of storage. */
  timestamp: number;
  /** Original output byte count. */
  sizeBytes: number;
}

export interface ToolResultRef {
  /** Short reference ID injected into prompts. */
  id: string;
  /** Tool that produced this result. */
  tool: string;
  /** One-line human-readable description for prompt injection. */
  description: string;
}

export interface ToolResultIndexStats {
  total: number;
  totalBytes: number;
}

// ── ToolResultIndex ───────────────────────────────────────────────────────────

export class ToolResultIndex {
  private readonly results: Map<string, ToolResult> = new Map();
  private counter = 0;

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Store a tool output and return a compact reference.
   *
   * @param nodeId  - The graph node that made this tool call.
   * @param tool    - Tool name (e.g. "read_file").
   * @param args    - Tool arguments as key→value pairs.
   * @param output  - Raw tool output string.
   */
  store(
    nodeId: string,
    tool:   string,
    args:   Record<string, string>,
    output: string,
  ): ToolResultRef {
    const id = `result_${++this.counter}`;

    const truncatedOutput = output.length > MAX_RESULT_SIZE
      ? output.slice(0, MAX_RESULT_SIZE) +
        `\n… [truncated — ${output.length - MAX_RESULT_SIZE} chars omitted]`
      : undefined;

    const result: ToolResult = {
      id,
      nodeId,
      tool,
      args,
      output,
      truncatedOutput,
      timestamp: Date.now(),
      sizeBytes: output.length,
    };

    this.results.set(id, result);

    // Evict the oldest entry when over the limit
    if (this.results.size > MAX_RESULTS) {
      const oldest = this.results.keys().next().value;
      if (oldest) this.results.delete(oldest);
    }

    const description = buildDescription(tool, args, output);
    logger.debug(`[tool-result-index] Stored ${id}: ${description.slice(0, 70)}`);

    return { id, tool, description };
  }

  // ── Cache lookup ───────────────────────────────────────────────────────────

  /**
   * Find an existing result for the same tool + args combination.
   *
   * Used for deduplication: if `read_file("src/auth.ts")` was already called in
   * this session, reuse its stored output instead of executing the tool again.
   *
   * Returns undefined when:
   *   - No matching entry exists
   *   - The existing entry is older than REUSE_TTL_MS (file may have changed)
   *   - Write-side tools (write_file, edit_file, git_commit, run_terminal, …)
   *     are never reused — they have side effects on disk / git state.
   */
  findByToolAndArgs(
    tool: string,
    args: Record<string, string>,
  ): ToolResult | undefined {
    // Never reuse write/exec tools — they change state on disk or in git
    const NO_REUSE = new Set([
      'write_file', 'edit_file', 'apply_patch',
      'run_terminal', 'git_add', 'git_commit', 'git_push',
      'git_create_pr', 'koda_commit',
    ]);
    if (NO_REUSE.has(tool)) return undefined;

    // Normalise arg object to a stable key (sort keys for order-independence)
    const queryKey = JSON.stringify(
      Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b))),
    );
    const now = Date.now();

    // Iterate newest-first so the most recent result wins
    const entries = Array.from(this.results.values()).reverse();
    for (const r of entries) {
      if (r.tool !== tool) continue;
      if (now - r.timestamp > REUSE_TTL_MS) continue; // stale
      const rKey = JSON.stringify(
        Object.fromEntries(Object.entries(r.args).sort(([a], [b]) => a.localeCompare(b))),
      );
      if (rKey === queryKey) return r;
    }
    return undefined;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /** Return the full result record by reference ID. */
  get(id: string): ToolResult | undefined {
    return this.results.get(id);
  }

  /**
   * Return the content to inject into an LLM prompt.
   * Uses the truncated form when the output exceeds MAX_RESULT_SIZE.
   */
  getOutput(id: string): string {
    const r = this.results.get(id);
    if (!r) return `[${id}: not found in tool result index]`;
    return r.truncatedOutput ?? r.output;
  }

  /**
   * Query results with optional filters.
   *
   * @param nodeId     - Restrict to results from this node.
   * @param toolFilter - Restrict to a specific tool name.
   * @param pattern    - Substring match against args + output.
   * @param limit      - Maximum results to return (default 10).
   */
  query(opts: {
    nodeId?:     string;
    toolFilter?: string;
    pattern?:    string;
    limit?:      number;
  }): ToolResult[] {
    const { nodeId, toolFilter, pattern, limit = 10 } = opts;
    const output: ToolResult[] = [];

    // Iterate newest-first
    const entries = Array.from(this.results.values()).reverse();
    for (const r of entries) {
      if (nodeId     && r.nodeId !== nodeId)     continue;
      if (toolFilter && r.tool   !== toolFilter)  continue;
      if (pattern) {
        const hay = `${JSON.stringify(r.args)} ${r.output}`.toLowerCase();
        if (!hay.includes(pattern.toLowerCase())) continue;
      }
      output.push(r);
      if (output.length >= limit) break;
    }

    return output;
  }

  /**
   * Build a compact multi-line string of reference descriptors for prompt injection.
   *
   * Example output:
   *   result_42: read_file: src/auth.ts (87 lines)
   *   result_43: run_terminal: pnpm test (34 lines)
   */
  buildContextRefs(resultIds: string[]): string {
    return resultIds
      .map((id) => {
        const r = this.results.get(id);
        if (!r) return `${id}: [not found]`;
        return `${id}: ${buildDescription(r.tool, r.args, r.output)}`;
      })
      .join('\n');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  getStats(): ToolResultIndexStats {
    let totalBytes = 0;
    for (const r of this.results.values()) totalBytes += r.sizeBytes;
    return { total: this.results.size, totalBytes };
  }

  /** Remove all results (e.g. on graph completion). */
  clear(): void {
    this.results.clear();
    this.counter = 0;
    logger.debug('[tool-result-index] Cleared all results');
  }

  /** Remove all results produced by a specific node. */
  clearNode(nodeId: string): void {
    for (const [id, r] of this.results) {
      if (r.nodeId === nodeId) this.results.delete(id);
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
  const base     = firstArg
    ? `${tool}: ${firstArg} (${lines} lines)`
    : `${tool} (${lines} lines)`;
  return base.slice(0, REF_DESCRIPTION_LIMIT);
}

/** Module-level singleton for use across the TEG runtime. */
export const toolResultIndex = new ToolResultIndex();
