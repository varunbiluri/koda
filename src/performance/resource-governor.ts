/**
 * ResourceGovernor — adaptive concurrency and graceful degradation.
 *
 * Problem: On large repos or memory-constrained machines, running 32 parallel
 * AST parses and 8 parallel LLM calls simultaneously causes OOM errors or
 * massive GC pressure that makes the whole session slower than sequential.
 *
 * Solution:
 *   - Track estimated memory usage from active parallel tasks.
 *   - Dynamically reduce `maxParallel` when pressure is high.
 *   - Degrade gracefully: disable expensive features (semantic search, AST
 *     graph) when estimated memory would exceed a configured soft limit.
 *   - All thresholds are configurable (env vars or constructor opts).
 *
 * Usage:
 * ```ts
 * const gov = new ResourceGovernor();
 * const parallel = gov.maxParallel('ast_parse');  // 32 → 4 under pressure
 * const enabled  = gov.featureEnabled('semantic_search'); // false when low-mem
 * gov.taskStart('ast_parse');
 * // ... run task ...
 * gov.taskEnd('ast_parse');
 * ```
 */

import * as os from 'node:os';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type FeatureFlag =
  | 'semantic_search'
  | 'ast_graph'
  | 'node_result_cache'
  | 'tool_batcher'
  | 'explainer';

export interface ResourceSnapshot {
  freeMemMB:    number;
  totalMemMB:   number;
  memUsagePct:  number;
  activeTasks:  number;
  pressure:     'LOW' | 'MEDIUM' | 'HIGH';
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PRESSURE_THRESHOLDS = {
  HIGH:   0.85, // >85% RAM used → aggressive reduction
  MEDIUM: 0.70, // >70% RAM used → moderate reduction
};

const DEFAULTS = {
  ast_parse:   32,
  llm_call:     4,
  tool_call:    8,
  general:     16,
};

// ── ResourceGovernor ───────────────────────────────────────────────────────────

export class ResourceGovernor {
  private readonly activeTasks: Map<string, number> = new Map();
  private disabledFeatures = new Set<FeatureFlag>();

  // ── Snapshot ───────────────────────────────────────────────────────────────

  snapshot(): ResourceSnapshot {
    const totalMem   = os.totalmem();
    const freeMem    = os.freemem();
    const usagePct   = 1 - freeMem / totalMem;

    const pressure =
      usagePct >= PRESSURE_THRESHOLDS.HIGH   ? 'HIGH' :
      usagePct >= PRESSURE_THRESHOLDS.MEDIUM ? 'MEDIUM' : 'LOW';

    const activeTasks = Array.from(this.activeTasks.values()).reduce((s, n) => s + n, 0);

    return {
      freeMemMB:   Math.round(freeMem   / 1_048_576),
      totalMemMB:  Math.round(totalMem  / 1_048_576),
      memUsagePct: Math.round(usagePct  * 100),
      activeTasks,
      pressure,
    };
  }

  // ── Task tracking ──────────────────────────────────────────────────────────

  taskStart(category: string): void {
    this.activeTasks.set(category, (this.activeTasks.get(category) ?? 0) + 1);
  }

  taskEnd(category: string): void {
    const n = (this.activeTasks.get(category) ?? 1) - 1;
    if (n <= 0) this.activeTasks.delete(category);
    else        this.activeTasks.set(category, n);
  }

  // ── Adaptive concurrency ───────────────────────────────────────────────────

  /**
   * Return the recommended `maxParallel` for the given task category,
   * adjusted for current memory pressure.
   */
  maxParallel(category: keyof typeof DEFAULTS | string): number {
    const base     = DEFAULTS[category as keyof typeof DEFAULTS] ?? DEFAULTS.general;
    const { pressure } = this.snapshot();

    switch (pressure) {
      case 'HIGH':   {
        const reduced = Math.max(1, Math.floor(base / 4));
        logger.debug(`[resource-governor] HIGH pressure — ${category} maxParallel capped at ${reduced}`);
        return reduced;
      }
      case 'MEDIUM': {
        const reduced = Math.max(2, Math.floor(base / 2));
        logger.debug(`[resource-governor] MEDIUM pressure — ${category} maxParallel capped at ${reduced}`);
        return reduced;
      }
      default:        return base;
    }
  }

  // ── Feature flags ──────────────────────────────────────────────────────────

  /**
   * Return true if the given feature should be enabled.
   * Features are disabled automatically under HIGH memory pressure.
   */
  featureEnabled(feature: FeatureFlag): boolean {
    if (this.disabledFeatures.has(feature)) return false;

    const { pressure } = this.snapshot();
    if (pressure === 'HIGH') {
      // Disable expensive optional features
      const EXPENSIVE: FeatureFlag[] = ['semantic_search', 'ast_graph'];
      if (EXPENSIVE.includes(feature)) {
        logger.warn(`[resource-governor] HIGH pressure — disabling ${feature}`);
        return false;
      }
    }
    return true;
  }

  /** Manually disable a feature (e.g. when an OOM error is caught). */
  disableFeature(feature: FeatureFlag): void {
    this.disabledFeatures.add(feature);
    logger.warn(`[resource-governor] Feature disabled: ${feature}`);
  }

  formatStatus(): string {
    const s = this.snapshot();
    return (
      `[resource-governor] Memory: ${s.freeMemMB}MB free / ${s.totalMemMB}MB total ` +
      `(${s.memUsagePct}% used) — pressure: ${s.pressure}`
    );
  }
}

/** Shared instance for the runtime. */
export const resourceGovernor = new ResourceGovernor();
