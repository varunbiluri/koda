/**
 * CostOptimizer — decide when an LLM call is necessary and track token cost.
 *
 * Problem: Koda calls the LLM for every node, even trivial operations like
 * listing files or reading a well-understood configuration file. Each call
 * costs tokens and latency.
 *
 * Solution:
 *   `shouldCallLLM(nodeType, context)` — returns false for deterministic tasks
 *   that don't need AI reasoning (list_files, git_status, version lookups).
 *
 *   `CostEstimator` — tracks token usage per session and logs cost estimates.
 *
 * GPT-4o pricing (approximate, used for estimation only):
 *   Input:  $5  / 1M tokens
 *   Output: $15 / 1M tokens
 *
 * Usage:
 * ```ts
 * if (!CostOptimizer.shouldCallLLM(node.type, context)) {
 *   return runDeterministicTool(node);
 * }
 * const result = await llm.chat(...);
 * CostOptimizer.record(promptTokens, completionTokens);
 * ```
 */

import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type NodeType =
  | 'ANALYSIS'
  | 'IMPLEMENTATION'
  | 'VERIFICATION'
  | 'FIX'
  | 'LISTING'
  | 'STATUS'
  | 'SEARCH'
  | string;

export interface CostRecord {
  /** Total prompt tokens this session. */
  promptTokens:     number;
  /** Total completion tokens this session. */
  completionTokens: number;
  /** Total estimated cost in USD cents. */
  estimatedCentUSD: number;
  /** Number of LLM calls made. */
  calls:            number;
  /** Number of LLM calls that were skipped via shouldCallLLM(). */
  skipped:          number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Node types that are always deterministic — no LLM needed. */
const DETERMINISTIC_NODE_TYPES = new Set<string>([
  'LISTING',
  'STATUS',
]);

/** Keywords in task descriptions that signal a deterministic operation. */
const DETERMINISTIC_PATTERNS = [
  /^list (files|directories|packages)/i,
  /^show git (status|log|diff)/i,
  /^check (node|python|go|rust) version/i,
  /^read package\.json/i,
  /^read \.koda\/config/i,
];

// Per-million-token prices in USD cents
const PRICE_INPUT_PER_M  = 500;  // $5.00 / M
const PRICE_OUTPUT_PER_M = 1500; // $15.00 / M

// ── CostOptimizer ──────────────────────────────────────────────────────────────

export class CostOptimizer {
  private record: CostRecord = {
    promptTokens:     0,
    completionTokens: 0,
    estimatedCentUSD: 0,
    calls:            0,
    skipped:          0,
  };

  // ── Decision gate ──────────────────────────────────────────────────────────

  /**
   * Return true if an LLM call is needed for this node.
   * Return false for deterministic operations that don't require reasoning.
   */
  shouldCallLLM(nodeType: NodeType, taskDescription: string): boolean {
    // Always-deterministic node types
    if (DETERMINISTIC_NODE_TYPES.has(nodeType)) {
      this.record.skipped++;
      logger.debug(`[cost-optimizer] Skipping LLM for deterministic node type: ${nodeType}`);
      return false;
    }

    // Pattern-based detection from task description
    for (const pattern of DETERMINISTIC_PATTERNS) {
      if (pattern.test(taskDescription)) {
        this.record.skipped++;
        logger.debug(`[cost-optimizer] Skipping LLM: task matches deterministic pattern "${taskDescription.slice(0, 60)}"`);
        return false;
      }
    }

    return true;
  }

  // ── Cost tracking ──────────────────────────────────────────────────────────

  /** Record token usage from a single LLM call. */
  recordUsage(promptTokens: number, completionTokens: number): void {
    this.record.promptTokens     += promptTokens;
    this.record.completionTokens += completionTokens;
    this.record.calls++;

    const cost = Math.round(
      (promptTokens * PRICE_INPUT_PER_M + completionTokens * PRICE_OUTPUT_PER_M) / 1_000_000,
    );
    this.record.estimatedCentUSD += cost;
  }

  /** Get current session cost record. */
  getRecord(): Readonly<CostRecord> {
    return { ...this.record };
  }

  /** Format a cost summary for logging. */
  formatSummary(): string {
    const r = this.record;
    if (r.calls === 0) return '[cost] No LLM calls this session.';

    const totalTokens = r.promptTokens + r.completionTokens;
    const dollars     = (r.estimatedCentUSD / 100).toFixed(4);
    const savings     = r.skipped > 0 ? ` (${r.skipped} calls avoided via cache/skip)` : '';

    return [
      `[cost] Session: ${r.calls} LLM calls${savings}`,
      `  Tokens:  ${totalTokens.toLocaleString()} (${r.promptTokens.toLocaleString()} in / ${r.completionTokens.toLocaleString()} out)`,
      `  Est. cost: $${dollars} USD`,
    ].join('\n');
  }

  /** Reset for a new session. */
  reset(): void {
    this.record = {
      promptTokens: 0, completionTokens: 0,
      estimatedCentUSD: 0, calls: 0, skipped: 0,
    };
  }
}

/** Shared instance for use across the runtime. */
export const costOptimizer = new CostOptimizer();
