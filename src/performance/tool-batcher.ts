/**
 * ToolBatcher — batch parallel tool calls within a node.
 *
 * Problem: Nodes that need to read 10 files do so sequentially, even though
 * file I/O is perfectly parallelisable. This is the single biggest latency
 * source in large-repo sessions.
 *
 * Solution:
 *   ToolBatcher collects tool call requests within a time window and then
 *   executes them in parallel (up to MAX_PARALLEL at a time).
 *
 *   For tools that are safe to batch (read_file, grep_code, list_files), the
 *   batcher: collects N calls → fires them all in one `Promise.all` batch →
 *   returns results in original order.
 *
 *   For stateful tools (write_file, run_terminal, git_*), each call is run
 *   immediately in isolation (no batching, no reordering).
 *
 * Usage:
 * ```ts
 * const batcher = new ToolBatcher({ maxParallel: 8 });
 * const [r1, r2, r3] = await batcher.run([
 *   { tool: 'read_file',  args: { path: 'src/auth.ts' } },
 *   { tool: 'read_file',  args: { path: 'src/user.ts' } },
 *   { tool: 'grep_code',  args: { pattern: 'TODO', path: 'src/' } },
 * ], executor);
 * ```
 */

import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ToolCall {
  tool: string;
  args: Record<string, string>;
}

export interface ToolCallResult {
  tool:    string;
  args:    Record<string, string>;
  output:  string;
  /** Whether the result came from cache (PersistentToolCache). */
  cached:  boolean;
  /** Execution time in milliseconds (0 if cached). */
  elapsed: number;
}

export type ToolExecutor = (tool: string, args: Record<string, string>) => Promise<string>;

export interface ToolBatcherOptions {
  /** Maximum concurrent tool calls. Default: 8. */
  maxParallel?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Tools that are safe to run in parallel (pure reads, no side effects). */
const BATCHABLE_TOOLS = new Set([
  'read_file',
  'grep_code',
  'search_code',
  'list_files',
  'git_log',
  'git_diff',
]);

// ── ToolBatcher ────────────────────────────────────────────────────────────────

export class ToolBatcher {
  private readonly maxParallel: number;
  private batchedCalls  = 0;
  private totalTime     = 0;
  private savedTime     = 0;

  constructor(opts: ToolBatcherOptions = {}) {
    this.maxParallel = opts.maxParallel ?? 8;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Execute a list of tool calls, batching parallel-safe ones.
   *
   * Stateful tools are run sequentially in the order they appear.
   * Batchable tools are collected into groups and run in parallel.
   *
   * @param calls    - Ordered list of tool calls to execute.
   * @param executor - Function that executes a single tool call.
   */
  async run(calls: ToolCall[], executor: ToolExecutor): Promise<ToolCallResult[]> {
    const results: ToolCallResult[] = new Array(calls.length);

    // Partition into batchable segments and stateful calls
    let i = 0;
    while (i < calls.length) {
      const call = calls[i];

      if (!BATCHABLE_TOOLS.has(call.tool)) {
        // Run stateful tool immediately
        const start   = Date.now();
        const output  = await executor(call.tool, call.args);
        const elapsed = Date.now() - start;
        results[i]    = { tool: call.tool, args: call.args, output, cached: false, elapsed };
        this.totalTime += elapsed;
        i++;
        continue;
      }

      // Collect a batch of batchable tools
      const batch: Array<{ index: number; call: ToolCall }> = [];
      while (i < calls.length && BATCHABLE_TOOLS.has(calls[i].tool)) {
        batch.push({ index: i, call: calls[i] });
        i++;
      }

      if (batch.length === 0) continue;

      // Execute the batch in parallel with bounded concurrency
      const wallStart = Date.now();
      await this._runBatch(batch, executor, results);
      const wallElapsed = Date.now() - wallStart;

      // Estimate sequential cost vs actual parallel wall time
      const sequentialSum = batch.reduce((s, b) => s + (results[b.index]?.elapsed ?? 0), 0);
      const actualSaving  = Math.max(0, sequentialSum - wallElapsed);
      this.savedTime  += actualSaving;
      this.totalTime  += wallElapsed;
      this.batchedCalls += batch.length;

      logger.debug(
        `[tool-batcher] Batch of ${batch.length}: ${wallElapsed}ms wall ` +
        `(saved ~${actualSaving}ms vs sequential)`,
      );
    }

    return results;
  }

  /** Return execution statistics. */
  getStats(): { batchedCalls: number; totalTimeMs: number; estimatedSavedMs: number } {
    return {
      batchedCalls:     this.batchedCalls,
      totalTimeMs:      this.totalTime,
      estimatedSavedMs: this.savedTime,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _runBatch(
    batch:    Array<{ index: number; call: ToolCall }>,
    executor: ToolExecutor,
    results:  ToolCallResult[],
  ): Promise<void> {
    // Process in chunks of maxParallel
    for (let j = 0; j < batch.length; j += this.maxParallel) {
      const chunk = batch.slice(j, j + this.maxParallel);
      await Promise.all(
        chunk.map(async ({ index, call }) => {
          const start   = Date.now();
          const output  = await executor(call.tool, call.args);
          const elapsed = Date.now() - start;
          results[index] = { tool: call.tool, args: call.args, output, cached: false, elapsed };
        }),
      );
    }
  }
}
