/**
 * DifferentiationDisplay — surfaces Koda's unique capabilities at key moments.
 *
 * Part 6 — Differentiation (product mission).
 *
 * Called by CLI commands at task completion to explain what Koda did
 * that a human (or a simpler tool) could not easily do.
 *
 * The goal: a developer who just watched Koda work should understand
 * WHY Koda is uniquely valuable — not just "it wrote some code".
 */

import chalk from 'chalk';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TaskOutcomeContext {
  /** Task succeeded on first attempt? */
  firstAttemptSuccess: boolean;
  /** Number of autonomous retries (fix loops). */
  retries: number;
  /** Files Koda wrote / modified. */
  filesChanged: number;
  /** Verification ran (tests / build). */
  verified: boolean;
  /** Impact analysis ran and detected high-impact files. */
  impactAnalysisRan: boolean;
  /** Memory / learning was used (non-first session). */
  usedPriorLearning: boolean;
}

// ── DifferentiationDisplay ────────────────────────────────────────────────────

export class DifferentiationDisplay {
  /**
   * Format a short "what just happened" insight block.
   * Returns empty string when there's nothing notable to surface.
   */
  static format(ctx: TaskOutcomeContext): string {
    const lines: string[] = [];
    const c = chalk.gray;
    const b = chalk.bold.white;

    // Autonomous retry — the single most differentiating capability
    if (ctx.retries > 0 && ctx.firstAttemptSuccess === false) {
      lines.push(
        `  ${chalk.cyan('⟳')}  Self-corrected ${ctx.retries}x  ` +
        chalk.gray('— no human intervention, tests confirmed the fix'),
      );
    }

    // Verification gate
    if (ctx.verified && ctx.firstAttemptSuccess) {
      lines.push(
        `  ${chalk.green('✓')}  Verified automatically  ` +
        chalk.gray('— build + tests confirmed correctness'),
      );
    }

    // Impact analysis
    if (ctx.impactAnalysisRan && ctx.filesChanged > 1) {
      lines.push(
        `  ${chalk.yellow('⊕')}  Impact-aware  ` +
        chalk.gray(`— analysed dependency graph before touching ${ctx.filesChanged} files`),
      );
    }

    // Learning
    if (ctx.usedPriorLearning) {
      lines.push(
        `  ${chalk.blue('◆')}  Learning applied  ` +
        chalk.gray('— used strategies that worked in previous sessions'),
      );
    }

    if (lines.length === 0) return '';

    return [
      chalk.bold.gray('\n  ── Why this worked ────────────────────────────'),
      ...lines,
      '',
    ].join('\n');
  }

  /**
   * Print a positioning reminder — shown on first successful task.
   * Highlights the Autonomous Engineer identity (Part 1).
   */
  static printPositioningBrief(): void {
    console.log();
    console.log(chalk.bold.blue('  Koda — Autonomous Engineer'));
    console.log(chalk.gray('  Give it a task. Come back to a working diff.'));
    console.log(chalk.gray('  Execution · Self-correction · Learning'));
    console.log();
  }

  /**
   * Compact one-liner comparing what a dev would have done manually.
   */
  static timeSavedMessage(durationMs: number, retries: number): string {
    const secs    = durationMs / 1000;
    const minutes = (secs / 60).toFixed(0);
    const retry   = retries > 0 ? `, ${retries} auto-retry` : '';
    return chalk.gray(`  Completed in ${secs.toFixed(1)}s (~${minutes}min of dev work automated${retry})`);
  }
}
