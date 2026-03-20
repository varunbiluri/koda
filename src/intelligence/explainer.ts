/**
 * Explainer — records and surfaces the reasoning behind Koda's decisions.
 *
 * When `--explain` is active, Koda annotates:
 *   - WHY this plan was chosen (routing decision + complexity rationale)
 *   - WHY this fix was applied (FailureAnalyzer classification + strategy)
 *   - WHAT alternatives were rejected (other strategies considered)
 *   - WHAT confidence level was assigned (ConfidenceEngine output)
 *
 * ExplainRecord is built up incrementally during execution and printed
 * at the end of each iteration when the flag is set.
 *
 * Usage:
 * ```ts
 * const explainer = new Explainer({ enabled: options.explain });
 * explainer.recordPlan('COMPLEX task — DAG scheduler', 'Multi-step implementation requires parallel agents');
 * explainer.recordFix('compile_error', 'run tsc --noEmit first', ['guess and check']);
 * explainer.setConfidence(confidenceScore);
 * console.log(explainer.format());
 * ```
 */

import { ConfidenceEngine, type ConfidenceScore } from './confidence-engine.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PlanExplanation {
  /** Route chosen: SIMPLE / MEDIUM / COMPLEX. */
  route:        string;
  /** Why this route was selected. */
  rationale:    string;
  /** Alternative routes that were considered and rejected. */
  alternatives: string[];
}

export interface FixExplanation {
  /** FailureAnalyzer classification. */
  failureType:         string;
  /** Strategy chosen for this retry. */
  strategyChosen:      string;
  /** Strategies that were available but not chosen. */
  alternatesRejected:  string[];
  /** Whether the fix was learned from history or hardcoded. */
  source:              'learned' | 'default';
}

export interface ExplainRecord {
  plan?:       PlanExplanation;
  fixes:       FixExplanation[];
  confidence?: ConfidenceScore;
  iterationMs: number[];
}

// ── Explainer ──────────────────────────────────────────────────────────────────

export class Explainer {
  private readonly enabled: boolean;
  private record: ExplainRecord = { fixes: [], iterationMs: [] };

  constructor(opts: { enabled: boolean }) {
    this.enabled = opts.enabled;
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Record the routing/planning decision.
   *
   * @param route        - Human label of the route (e.g. "COMPLEX task — multi-agent").
   * @param rationale    - Why this route was chosen.
   * @param alternatives - Routes that were available but not chosen.
   */
  recordPlan(route: string, rationale: string, alternatives: string[] = []): void {
    if (!this.enabled) return;
    this.record.plan = { route, rationale, alternatives };
  }

  /**
   * Record a fix attempt.
   *
   * @param failureType       - FailureAnalyzer type.
   * @param strategyChosen    - Strategy selected for this retry.
   * @param alternatesRejected - Other strategies that were available.
   * @param source             - Whether strategy came from LearningLoop or hardcode.
   */
  recordFix(
    failureType:        string,
    strategyChosen:     string,
    alternatesRejected: string[] = [],
    source:             'learned' | 'default' = 'default',
  ): void {
    if (!this.enabled) return;
    this.record.fixes.push({ failureType, strategyChosen, alternatesRejected, source });
  }

  /**
   * Set the final confidence score.
   */
  setConfidence(score: ConfidenceScore): void {
    if (!this.enabled) return;
    this.record.confidence = score;
  }

  /**
   * Record the wall-clock duration of one iteration.
   */
  recordIteration(ms: number): void {
    if (!this.enabled) return;
    this.record.iterationMs.push(ms);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  get isEnabled(): boolean { return this.enabled; }

  /**
   * Format the full explanation report for terminal display.
   * Returns empty string when `--explain` is not active.
   */
  format(): string {
    if (!this.enabled) return '';

    const lines: string[] = [
      '─────────────────────────────────────────',
      ' Koda Explanation Report',
      '─────────────────────────────────────────',
      '',
    ];

    // ── Plan ─────────────────────────────────────────────────────────────────
    if (this.record.plan) {
      const p = this.record.plan;
      lines.push('## Routing Decision');
      lines.push(`  Chosen route:  ${p.route}`);
      lines.push(`  Rationale:     ${p.rationale}`);
      if (p.alternatives.length > 0) {
        lines.push('  Alternatives rejected:');
        for (const alt of p.alternatives) lines.push(`    · ${alt}`);
      }
      lines.push('');
    }

    // ── Fixes ─────────────────────────────────────────────────────────────────
    if (this.record.fixes.length > 0) {
      lines.push('## Fix Decisions');
      this.record.fixes.forEach((f, i) => {
        lines.push(`  Retry ${i + 1}:`);
        lines.push(`    Failure type:     ${f.failureType}`);
        lines.push(`    Strategy chosen:  ${f.strategyChosen}`);
        lines.push(`    Strategy source:  ${f.source === 'learned' ? 'LearningLoop (empirical)' : 'built-in default'}`);
        if (f.alternatesRejected.length > 0) {
          lines.push(`    Alternatives:     ${f.alternatesRejected.join('; ')}`);
        }
      });
      lines.push('');
    }

    // ── Confidence ────────────────────────────────────────────────────────────
    if (this.record.confidence) {
      lines.push('## Confidence Assessment');
      lines.push(
        ConfidenceEngine.formatReport(this.record.confidence)
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
      );
      lines.push('');
    }

    // ── Timing ────────────────────────────────────────────────────────────────
    if (this.record.iterationMs.length > 0) {
      lines.push('## Timing');
      this.record.iterationMs.forEach((ms, i) => {
        lines.push(`  Iteration ${i + 1}: ${(ms / 1000).toFixed(1)}s`);
      });
      const total = this.record.iterationMs.reduce((s, n) => s + n, 0);
      lines.push(`  Total:       ${(total / 1000).toFixed(1)}s`);
      lines.push('');
    }

    lines.push('─────────────────────────────────────────');
    return lines.join('\n');
  }
}
