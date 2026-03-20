/**
 * koda fix "<description>"
 *
 * Primary workflow #1 — Bug Fix (Part 3, Part 4 product mission).
 *
 * User experience:
 *   $ koda fix "null pointer in auth middleware"
 *
 *   ⚡ Koda — Autonomous Bug Fix
 *      null pointer in auth middleware
 *
 *   ── Step 1 / 3 ──────────────────────
 *      ○ Searching for auth middleware...
 *      ○ Root cause: token not validated before access
 *      ○ Applying patch to src/middleware/auth.ts
 *   ── Verify ──────────────────────────
 *      ○ Running pnpm test...
 *   ✓ Fix verified in 1 step
 *
 * What makes this different (Part 6 — differentiation):
 *   - Autonomous retry: if tests fail, Koda re-analyses and patches again
 *   - Impact-aware: warns before touching high-dependency files
 *   - Learning: remembers which fix strategies work for this repo
 *
 * Flags:
 *   --iterations <n>   Max fix loops (default 3)
 *   --explain          Show reasoning after each iteration
 *   --commit           Remind to commit when fix is verified
 *   --no-verify        Skip test verification
 *   --force            Auto-approve HIGH-impact writes without prompting
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'node:path';
import { configExists, loadConfig } from '../../ai/config-store.js';
import { AzureAIProvider } from '../../ai/providers/azure-provider.js';
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import { DagVerification } from '../../intelligence/dag-verification.js';
import { RepoContextAnalyzer } from '../../intelligence/repo-context-analyzer.js';
import { GlobalMemoryStore } from '../../intelligence/global-memory-store.js';
import { LearningLoop } from '../../intelligence/learning-loop.js';
import { ConfidenceEngine } from '../../intelligence/confidence-engine.js';
import { Explainer } from '../../intelligence/explainer.js';
import { failureAnalyzer } from '../../execution/failure-analyzer.js';
import { loadIndexMetadata } from '../../store/index-store.js';
import { ProductMetrics } from '../../product/metrics.js';
import { handleCliError } from '../errors.js';

const DEFAULT_MAX_ITERATIONS = 3;

function errorFingerprint(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

export const fixCommand = new Command('fix')
  .description('Fix a bug autonomously — detect, patch, verify, retry until done')
  .argument('<description>', 'Bug description in plain English')
  .option('-n, --iterations <n>',   'Max fix→verify loops', String(DEFAULT_MAX_ITERATIONS))
  .option('--explain',              'Print detailed reasoning after each iteration')
  .option('--commit',               'Remind to commit when fix is verified')
  .option('--no-verify',            'Skip test verification')
  .option('--force',                'Auto-approve HIGH-impact writes without prompting')
  .action(async (description: string, options: {
    iterations:  string;
    explain?:    boolean;
    commit?:     boolean;
    verify:      boolean;
    force?:      boolean;
  }) => {
    const rootPath      = process.cwd();
    const maxIterations = Math.max(1, parseInt(options.iterations ?? String(DEFAULT_MAX_ITERATIONS), 10));
    const doVerify      = options.verify !== false;
    const startTime     = Date.now();

    // ── Header ──────────────────────────────────────────────────────────────
    console.log();
    console.log(chalk.bold.blue('⚡ Koda — Autonomous Bug Fix'));
    console.log(chalk.gray(`   ${description}`));
    console.log();

    if (!await configExists()) {
      console.error(chalk.red('✗ No AI config found. Run `koda login` first.\n'));
      process.exit(1);
    }

    // ── Load metrics (non-fatal) ─────────────────────────────────────────────
    let metrics: ProductMetrics | null = null;
    try {
      metrics = await ProductMetrics.load(rootPath);
      metrics.taskStart('fix', description);
    } catch { /* non-fatal */ }

    try {
      const config    = await loadConfig();
      const provider  = new AzureAIProvider(config);
      const repoEnv   = await RepoContextAnalyzer.analyze(rootPath);
      const memory    = await GlobalMemoryStore.load(rootPath);
      const learner   = await LearningLoop.load(rootPath);
      const explainer = new Explainer({ enabled: !!options.explain });

      // Load index (non-fatal)
      let index = null;
      try {
        const meta = await loadIndexMetadata(rootPath);
        if (meta) {
          const { loadIndex } = await import('../../store/index-store.js');
          index = await loadIndex(rootPath);
        }
      } catch { /* no index */ }

      const filePaths = index?.chunks.map((c: { filePath: string }) => c.filePath) ?? [];
      const chatContext = {
        repoName:  path.basename(rootPath),
        branch:    'fix',
        rootPath,
        fileCount: filePaths.length,
      };

      const memHint    = memory.getContextHint(description);
      const repoCtx    = repoEnv.formatForPrompt();
      const systemHint = [repoCtx, memHint].filter(Boolean).join('\n\n');

      // ── Fix loop ─────────────────────────────────────────────────────────────
      let currentTask  = `Fix this bug: ${description}${systemHint ? `\n\n${systemHint}` : ''}`;
      let iteration    = 0;
      let succeeded    = false;
      let totalRetries = 0;
      const seenFingerprints = new Set<string>();
      let sameErrorCount = 0;

      while (iteration < maxIterations) {
        iteration++;
        console.log(chalk.bold.cyan(`── Step ${iteration} / ${maxIterations} ──────────────────────`));

        const engine = new ReasoningEngine(index, provider);
        try {
          await engine.chat(
            currentTask,
            chatContext,
            [],
            (chunk: string) => { /* streaming chunk — not displayed here */ },
            (stage: string) => {
              const icon  = stage.startsWith('WARN') ? '⚠' :
                            stage.startsWith('ERROR') ? '✗' : '○';
              const color = stage.startsWith('WARN') ? chalk.yellow :
                            stage.startsWith('ERROR') ? chalk.red : chalk.gray;
              console.log(color(`   ${icon} ${stage.replace(/^(INFO|WARN|ERROR)\s+/, '').slice(0, 110)}`));
            },
          );
        } catch (execErr) {
          console.log(chalk.red(`   ✗ Execution error: ${(execErr as Error).message}`));
          break;
        }

        if (!doVerify) {
          succeeded = true;
          break;
        }

        // ── Verify ───────────────────────────────────────────────────────────
        console.log(chalk.gray('\n   ○ Verifying…'));
        const verifier  = new DagVerification(rootPath, {
          buildCmd: repoEnv.buildCommand ?? 'pnpm build',
          testCmd:  repoEnv.testCommand  ?? 'pnpm test',
        });
        const verResult  = await verifier.verify();
        const confidence = ConfidenceEngine.assessWithMemory(
          { retries: iteration - 1, verificationPassed: verResult.passed, impactLevel: 'LOW', isFixAttempt: true },
          description,
          memory,
        );

        console.log(chalk.gray(`   ○ ${ConfidenceEngine.formatStage(confidence)}`));

        if (verResult.passed) {
          console.log(chalk.green(`\n   ✓ Fix verified in ${iteration} step${iteration > 1 ? 's' : ''}`));
          if (options.explain) {
            explainer.setConfidence(confidence);
            console.log(chalk.gray(explainer.format()));
          }
          succeeded = true;
          break;
        }

        totalRetries++;
        const errFP = errorFingerprint(verResult.summary);
        if (seenFingerprints.has(errFP)) {
          sameErrorCount++;
          if (sameErrorCount >= 2) {
            console.log(chalk.yellow('\n   ⚠ Same error repeated — stopping to avoid loop'));
            break;
          }
        }
        seenFingerprints.add(errFP);

        if (confidence.level === 'LOW' && iteration >= 2) {
          console.log(chalk.yellow('\n   ⚠ Confidence is LOW — stopping'));
          break;
        }

        // Build fix prompt for next iteration
        const analysis   = failureAnalyzer.classify(verResult.summary);
        const stratHint  = learner.formatHint(analysis.type);
        currentTask = [
          `Previous fix attempt failed. Error:\n${verResult.summary}`,
          analysis.fixPrompt ? `Suggested approach: ${analysis.fixPrompt}` : '',
          stratHint,
          `\nOriginal task: Fix this bug: ${description}`,
          systemHint,
        ].filter(Boolean).join('\n\n');

        learner.recordOutcome(analysis.type, 'iterative_patch', false);
        await learner.save();
      }

      // ── Result ───────────────────────────────────────────────────────────────
      const durationMs = Date.now() - startTime;
      console.log();
      if (succeeded) {
        const secs = (durationMs / 1000).toFixed(1);
        console.log(chalk.bold.green(`✓ Done in ${secs}s`));
        if (totalRetries > 0) {
          console.log(chalk.gray(`  (Self-corrected ${totalRetries} time${totalRetries > 1 ? 's' : ''} — no manual intervention needed)`));
        }
        if (options.commit) {
          console.log(chalk.gray('  Run `git diff` to review changes.'));
        }

        memory.recordTask({ description, succeeded: true, retries: totalRetries, durationMs, filesChanged: [] });
        learner.recordOutcome('bug_fix', 'iterative_patch', true);
      } else {
        console.log(chalk.bold.red('✗ Could not fully resolve the bug automatically.'));
        console.log(chalk.gray('  Review the partial changes above or re-run with more context.'));
        memory.recordTask({ description, succeeded: false, retries: totalRetries, durationMs, filesChanged: [] });
      }

      await Promise.all([memory.save(), learner.save()]);

      if (metrics) {
        metrics.taskComplete({ success: succeeded, retries: totalRetries, durationMs });
        await metrics.flush();
        const oneliner = metrics.formatOneLiner();
        if (oneliner) console.log(chalk.gray(`\n  ${oneliner}`));
      }

    } catch (err) {
      handleCliError(err);
      if (metrics) {
        metrics.taskComplete({ success: false, retries: 0 });
        await metrics.flush();
      }
    }
  });
