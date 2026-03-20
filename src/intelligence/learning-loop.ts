/**
 * LearningLoop — tracks which fix strategies succeed or fail over time,
 * and adapts the retry strategy for future failures.
 *
 * Data persisted at: <rootPath>/.koda/learning.json
 *
 * Schema per entry:
 *   failureType  — one of FailureAnalyzer's types (compile_error, test_failure, …)
 *   strategy     — short description of what was tried
 *   wins         — times this (type, strategy) pair resolved the failure
 *   losses       — times it did not resolve the failure
 *   winRate      — wins / (wins + losses), updated on each outcome
 *   lastUpdated  — ISO timestamp
 *
 * The `GraphScheduler` consults `getBestStrategy(failureType)` when building
 * a retry node prompt, so it uses historically successful approaches first.
 *
 * Usage:
 * ```ts
 * const loop = await LearningLoop.load(rootPath);
 * loop.recordOutcome('compile_error', 'run tsc --noEmit first', true);
 * await loop.save();
 *
 * const best = loop.getBestStrategy('compile_error');
 * // → 'run tsc --noEmit first'  (highest win rate for this failure type)
 * ```
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StrategyRecord {
  failureType:  string;
  strategy:     string;
  wins:         number;
  losses:       number;
  winRate:      number;
  lastUpdated:  string;
}

interface LearningData {
  version:    number;
  strategies: StrategyRecord[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STORE_VERSION = 1;
const MAX_RECORDS   = 500;

// ── LearningLoop ───────────────────────────────────────────────────────────────

export class LearningLoop {
  private data: LearningData;
  private readonly filePath: string;

  private constructor(filePath: string, data: LearningData) {
    this.filePath = filePath;
    this.data     = data;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static async load(rootPath: string): Promise<LearningLoop> {
    const fp = storePath(rootPath);
    try {
      const raw  = await fs.readFile(fp, 'utf8');
      const data = JSON.parse(raw) as LearningData;
      if (data.version !== STORE_VERSION) return new LearningLoop(fp, fresh());
      return new LearningLoop(fp, data);
    } catch {
      return new LearningLoop(fp, fresh());
    }
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Record an outcome for a (failureType, strategy) pair.
   *
   * @param failureType  - FailureAnalyzer classification (e.g. "compile_error")
   * @param strategy     - Short strategy description
   * @param succeeded    - Whether the strategy resolved the failure
   */
  recordOutcome(failureType: string, strategy: string, succeeded: boolean): void {
    const existing = this.data.strategies.find(
      (r) => r.failureType === failureType && r.strategy === strategy,
    );

    if (existing) {
      if (succeeded) existing.wins++;
      else           existing.losses++;
      existing.winRate     = existing.wins / (existing.wins + existing.losses);
      existing.lastUpdated = new Date().toISOString();
    } else {
      const record: StrategyRecord = {
        failureType,
        strategy,
        wins:        succeeded ? 1 : 0,
        losses:      succeeded ? 0 : 1,
        winRate:     succeeded ? 1.0 : 0.0,
        lastUpdated: new Date().toISOString(),
      };
      this.data.strategies.unshift(record);
      if (this.data.strategies.length > MAX_RECORDS) {
        this.data.strategies = this.data.strategies.slice(0, MAX_RECORDS);
      }
    }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Return the strategy with the highest win rate for a given failure type.
   * Returns null when no data exists for this failure type.
   *
   * Requires at least 2 observations (wins + losses ≥ 2) to avoid noise from
   * single-sample data.
   */
  getBestStrategy(failureType: string): string | null {
    const candidates = this.data.strategies
      .filter((r) => r.failureType === failureType && r.wins + r.losses >= 2)
      .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);
    return candidates[0]?.strategy ?? null;
  }

  /**
   * Return all strategy records for a given failure type, sorted by win rate.
   */
  getStrategies(failureType: string): StrategyRecord[] {
    return this.data.strategies
      .filter((r) => r.failureType === failureType)
      .sort((a, b) => b.winRate - a.winRate);
  }

  /**
   * Format a human-readable summary of accumulated learning for a failure type.
   * Used for injecting into retry node prompts.
   */
  formatHint(failureType: string): string {
    const best = this.getBestStrategy(failureType);
    if (!best) return '';
    const record = this.data.strategies.find(
      (r) => r.failureType === failureType && r.strategy === best,
    );
    if (!record) return '';
    const pct = Math.round(record.winRate * 100);
    return `[Learning] Best known strategy for ${failureType} (${pct}% success): ${best}`;
  }

  /**
   * Overall statistics: total observations, unique failure types learned.
   */
  getStats(): { totalObservations: number; failureTypesLearned: number } {
    const total = this.data.strategies.reduce((n, r) => n + r.wins + r.losses, 0);
    const types = new Set(this.data.strategies.map((r) => r.failureType)).size;
    return { totalObservations: total, failureTypesLearned: types };
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      // non-fatal
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function storePath(rootPath: string): string {
  return path.join(rootPath, '.koda', 'learning.json');
}

function fresh(): LearningData {
  return { version: STORE_VERSION, strategies: [] };
}
