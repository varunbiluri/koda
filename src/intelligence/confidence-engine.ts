/**
 * ConfidenceEngine — quantifies Koda's confidence in a task outcome.
 *
 * Every result Koda produces can be scored along three axes:
 *
 *   1. Execution quality   — did it succeed on first try? How many retries?
 *   2. Verification result — did build+test pass after execution?
 *   3. Historical base     — what's the success rate for similar past tasks?
 *
 * The composite score (0–1) maps to three levels:
 *   LOW     (< 0.40) — result is uncertain; human review advised
 *   MEDIUM  (0.40–0.74) — result is probably correct; spot-check recommended
 *   HIGH    (≥ 0.75) — result is reliable; safe to trust in auto mode
 *
 * Usage:
 * ```ts
 * const score = ConfidenceEngine.assess({
 *   retries:               2,
 *   verificationPassed:    true,
 *   similarTaskSuccessRate: 0.8,
 *   impactLevel:           'HIGH',
 * });
 * // score.level → 'MEDIUM'
 * // score.reasoning → 'Required 2 retries (-0.20). Verification passed (+0.30). ...'
 * ```
 */

import type { ImpactLevel } from './repo-graph.js';
import type { GlobalMemoryStore } from './global-memory-store.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ConfidenceScore {
  /** Qualitative confidence tier. */
  level:     ConfidenceLevel;
  /** Raw score in [0, 1]. */
  score:     number;
  /** Human-readable justification for each contributing factor. */
  factors:   string[];
  /** One-sentence summary suitable for stream injection. */
  reasoning: string;
}

export interface AssessInput {
  /** Number of retry attempts needed (0 = first-try success). */
  retries:                number;
  /** Whether post-execution build+test verification passed. */
  verificationPassed?:    boolean;
  /** Historical success rate for similar tasks (0–1, or null = unknown). */
  similarTaskSuccessRate?: number | null;
  /** Impact level of the changed files (HIGH impact → lower confidence). */
  impactLevel?:           ImpactLevel;
  /** Whether this was a fix/recovery attempt (vs original task). */
  isFixAttempt?:          boolean;
}

// ── ConfidenceEngine ───────────────────────────────────────────────────────────

export class ConfidenceEngine {
  // ── Core assessment ────────────────────────────────────────────────────────

  /**
   * Assess confidence from execution metadata.
   *
   * Scoring model (starts at 0.70 baseline):
   *   +0.30  verification passed
   *   -0.15  verification failed / skipped
   *   -0.10  per retry (capped at -0.30 for 3+ retries)
   *   +0.10  historical success rate ≥ 0.80
   *   -0.10  historical success rate < 0.40
   *   -0.10  impact level HIGH (riskier change)
   *   -0.05  fix/recovery attempt (less certain than first-try)
   */
  static assess(input: AssessInput): ConfidenceScore {
    let score   = 0.70;
    const factors: string[] = [];

    // ── Verification ─────────────────────────────────────────────────────────
    if (input.verificationPassed === true) {
      score += 0.30;
      factors.push('Verification passed (+0.30)');
    } else if (input.verificationPassed === false) {
      score -= 0.15;
      factors.push('Verification failed (−0.15)');
    } else {
      // Unknown (verification was skipped)
      factors.push('Verification not run (neutral)');
    }

    // ── Retries ───────────────────────────────────────────────────────────────
    const retryPenalty = Math.min(0.30, input.retries * 0.10);
    if (retryPenalty > 0) {
      score -= retryPenalty;
      factors.push(`Required ${input.retries} retr${input.retries === 1 ? 'y' : 'ies'} (−${retryPenalty.toFixed(2)})`);
    } else {
      factors.push('First-try success (no penalty)');
    }

    // ── Historical success rate ───────────────────────────────────────────────
    const hist = input.similarTaskSuccessRate;
    if (hist !== null && hist !== undefined) {
      if (hist >= 0.80) {
        score += 0.10;
        factors.push(`Historical success rate ${Math.round(hist * 100)}% (+0.10)`);
      } else if (hist < 0.40) {
        score -= 0.10;
        factors.push(`Historical success rate ${Math.round(hist * 100)}% (−0.10)`);
      } else {
        factors.push(`Historical success rate ${Math.round(hist * 100)}% (neutral)`);
      }
    }

    // ── Impact level ──────────────────────────────────────────────────────────
    if (input.impactLevel === 'HIGH') {
      score -= 0.10;
      factors.push('High-impact change (−0.10)');
    }

    // ── Fix attempt ───────────────────────────────────────────────────────────
    if (input.isFixAttempt) {
      score -= 0.05;
      factors.push('Fix/recovery attempt (−0.05)');
    }

    // Clamp to [0, 1]
    score = Math.max(0, Math.min(1, score));

    const level: ConfidenceLevel = score >= 0.75 ? 'HIGH' : score >= 0.40 ? 'MEDIUM' : 'LOW';
    const reasoning = `Confidence: ${level} (score ${score.toFixed(2)}). ${factors.slice(0, 2).join('. ')}.`;

    return { level, score, factors, reasoning };
  }

  /**
   * Assess confidence using GlobalMemoryStore for the historical base rate.
   *
   * Looks up similar past tasks and computes their success rate.
   */
  static assessWithMemory(
    input:  Omit<AssessInput, 'similarTaskSuccessRate'>,
    query:  string,
    memory: GlobalMemoryStore,
  ): ConfidenceScore {
    const similarTasks = memory.getRelevantTasks(query, 10);
    let successRate: number | null = null;

    if (similarTasks.length >= 3) {
      const successes = similarTasks.filter((t) => t.succeeded).length;
      successRate     = successes / similarTasks.length;
    }

    return ConfidenceEngine.assess({ ...input, similarTaskSuccessRate: successRate });
  }

  // ── Formatting ────────────────────────────────────────────────────────────

  /**
   * Format a confidence score for terminal display (one-line stage message).
   */
  static formatStage(score: ConfidenceScore): string {
    const icon  = score.level === 'HIGH' ? '🟢' : score.level === 'MEDIUM' ? '🟡' : '🔴';
    return `INFO CONFIDENCE: ${icon} ${score.level} (${(score.score * 100).toFixed(0)}%) — ${score.factors[0] ?? ''}`;
  }

  /**
   * Format a detailed multi-line confidence report for `--explain` output.
   */
  static formatReport(score: ConfidenceScore): string {
    const lines = [
      `Confidence: ${score.level} (${(score.score * 100).toFixed(0)}%)`,
      '',
      'Contributing factors:',
      ...score.factors.map((f) => `  · ${f}`),
    ];
    return lines.join('\n');
  }
}
