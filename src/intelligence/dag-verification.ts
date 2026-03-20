/**
 * DagVerification — post-execution correctness checks for the COMPLEX path.
 *
 * After a DAG finishes, Koda runs two verification passes:
 *
 *   1. Build check   — `pnpm build` (TypeScript compile / bundler)
 *   2. Test check    — `pnpm test`  (only when build succeeds)
 *
 * On failure the caller receives a structured `VerificationResult` that:
 *   - Identifies which check failed and why (via FailureAnalyzer)
 *   - Produces a fix prompt ready for injection into a recovery node
 *
 * The fix node can be inserted back into the DAG and re-scheduled so Koda
 * autonomously corrects its own mistakes without user intervention.
 *
 * Usage:
 * ```ts
 * const verifier = new DagVerification(rootPath, { buildCmd: 'pnpm build', testCmd: 'pnpm test' });
 * const result   = await verifier.verify({ onStage, signal });
 * if (!result.passed) {
 *   const fixPrompt = verifier.buildFixPrompt(result);
 *   // insert recovery node into graph with fixPrompt
 * }
 * ```
 */

import { SandboxManager } from '../runtime/sandbox-manager.js';
import { failureAnalyzer, type FailureAnalysis } from '../execution/failure-analyzer.js';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface VerificationCheck {
  name:    string;
  passed:  boolean;
  output:  string;
  analysis?: FailureAnalysis;
}

export interface VerificationResult {
  /** True only when every check passes. */
  passed:   boolean;
  /** Individual check outcomes. */
  checks:   VerificationCheck[];
  /** One-line human-readable summary, e.g. "✔ build · ✗ tests". */
  summary:  string;
  /** How long verification took. */
  durationMs: number;
}

export interface DagVerificationOptions {
  /** Shell command to verify the build (default: "pnpm build"). */
  buildCmd?: string;
  /** Shell command to run tests (default: "pnpm test"). */
  testCmd?:  string;
  /**
   * When true, run the test suite even if the build failed.
   * Default: false (skip tests on build failure to avoid noise).
   */
  testOnBuildFailure?: boolean;
}

// ── DagVerification ───────────────────────────────────────────────────────────

export class DagVerification {
  private readonly sandbox:   SandboxManager;
  private readonly buildCmd:  string;
  private readonly testCmd:   string;
  private readonly testOnBuildFailure: boolean;

  constructor(rootPath: string, opts: DagVerificationOptions = {}) {
    this.sandbox              = new SandboxManager(rootPath);
    this.buildCmd             = opts.buildCmd             ?? 'pnpm build';
    this.testCmd              = opts.testCmd              ?? 'pnpm test';
    this.testOnBuildFailure   = opts.testOnBuildFailure   ?? false;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Run post-DAG verification checks.
   *
   * @param opts.onStage  - Progress callback (displayed in the terminal).
   * @param opts.signal   - AbortSignal to cancel long-running checks.
   */
  async verify(opts: {
    onStage?: (msg: string) => void;
    signal?:  AbortSignal;
  } = {}): Promise<VerificationResult> {
    const t0     = Date.now();
    const checks: VerificationCheck[] = [];

    // ── Check 1: Build ───────────────────────────────────────────────────────
    opts.onStage?.('INFO VERIFY build');
    logger.info(`[dag-verification] Running build check: ${this.buildCmd}`);

    const buildRun = await this.sandbox.execute(this.buildCmd, { signal: opts.signal });
    const buildOutput = (buildRun.stdout + '\n' + buildRun.stderr).trim();
    const buildPassed = buildRun.exitCode === 0;

    checks.push({
      name:     'build',
      passed:   buildPassed,
      output:   buildOutput.slice(0, 2000),
      analysis: buildPassed ? undefined : failureAnalyzer.classify(buildOutput),
    });

    logger.info(`[dag-verification] Build: ${buildPassed ? 'PASSED' : 'FAILED'}`);

    // ── Check 2: Tests ───────────────────────────────────────────────────────
    if (buildPassed || this.testOnBuildFailure) {
      opts.onStage?.('INFO VERIFY tests');
      logger.info(`[dag-verification] Running test check: ${this.testCmd}`);

      const testRun = await this.sandbox.execute(this.testCmd, { signal: opts.signal });
      const testOutput = (testRun.stdout + '\n' + testRun.stderr).trim();
      const testPassed = testRun.exitCode === 0;

      checks.push({
        name:     'tests',
        passed:   testPassed,
        output:   testOutput.slice(0, 3000),
        analysis: testPassed ? undefined : failureAnalyzer.classify(testOutput),
      });

      logger.info(`[dag-verification] Tests: ${testPassed ? 'PASSED' : 'FAILED'}`);
    }

    const passed = checks.every((c) => c.passed);
    const summary = checks.map((c) => `${c.passed ? '✔' : '✗'} ${c.name}`).join(' · ');

    return { passed, checks, summary, durationMs: Date.now() - t0 };
  }

  /**
   * Build a self-healing fix prompt from failed verification checks.
   *
   * The result can be used directly as the `description` / `context.task`
   * of a recovery node inserted back into the DAG.
   */
  buildFixPrompt(result: VerificationResult): string {
    const failedChecks = result.checks.filter((c) => !c.passed);
    if (failedChecks.length === 0) return '';

    const lines: string[] = [
      'Post-execution verification failed. Fix ALL of the following issues, then re-verify.',
      '',
    ];

    for (const check of failedChecks) {
      const analysis = check.analysis ?? failureAnalyzer.classify(check.output);
      lines.push(`## ${check.name} failure  (${analysis.type} — confidence ${(analysis.confidence * 100).toFixed(0)}%)`);
      lines.push('');
      lines.push(analysis.fixPrompt);
      lines.push('');
      lines.push(`Raw output:\n\`\`\`\n${check.output.slice(0, 600)}\n\`\`\``);
      lines.push('');
    }

    lines.push('After applying all fixes, re-run the verification commands to confirm they pass.');
    return lines.join('\n');
  }
}
