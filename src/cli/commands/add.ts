/**
 * koda add "<feature>"
 *
 * Primary workflow #2 — Feature Addition (Part 3, Part 4 product mission).
 *
 * User experience:
 *   $ koda add "rate limiting middleware with Redis"
 *
 *   ⚡ Koda — Add Feature
 *      rate limiting middleware with Redis
 *      (includes test generation)
 *
 *   ── Planning ──────────────────────────
 *      ○ Analysing existing middleware patterns...
 *      ○ Plan: 3 files — create, update, test
 *   ── Implementing ──────────────────────
 *      ○ Writing src/middleware/rate-limit.ts
 *      ○ Updating src/app.ts
 *      ○ Writing tests/middleware/rate-limit.test.ts
 *   ── Verifying ─────────────────────────
 *      ✓ Feature added and verified
 *
 * What makes this different (Part 6 — differentiation):
 *   - Plan-first: analyses existing patterns before writing any code
 *   - Symbol-aware: reads existing APIs to match code style
 *   - Test generation included by default
 *   - Self-correcting on verification failures
 *
 * Flags:
 *   --no-tests         Skip generating tests for new code
 *   --explain          Show planning reasoning
 *   --commit           Remind to commit when verified
 *   --no-verify        Skip test verification
 *   --iterations <n>   Max fix loops on verification failure (default 2)
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
import { loadIndexMetadata } from '../../store/index-store.js';
import { ProductMetrics } from '../../product/metrics.js';
import { handleCliError } from '../errors.js';

const DEFAULT_ITERATIONS = 2;

export function createAddCommand(): Command {
  return new Command('add')
    .description('Add a feature autonomously — plan, implement, test, verify')
    .argument('<description>', 'Feature to add, in plain English')
    .option('-n, --iterations <n>',   'Max verification fix loops', String(DEFAULT_ITERATIONS))
    .option('--no-tests',             'Skip generating tests for new code')
    .option('--explain',              'Show planning reasoning')
    .option('--commit',               'Remind to commit when verified')
    .option('--no-verify',            'Skip test verification')
    .action(async (description: string, options: {
      iterations:  string;
      tests:       boolean;
      explain?:    boolean;
      commit?:     boolean;
      verify:      boolean;
    }) => {
      const rootPath      = process.cwd();
      const maxIterations = Math.max(1, parseInt(options.iterations ?? String(DEFAULT_ITERATIONS), 10));
      const doVerify      = options.verify !== false;
      const generateTests = options.tests !== false;
      const startTime     = Date.now();

      // ── Header ──────────────────────────────────────────────────────────────
      console.log();
      console.log(chalk.bold.blue('⚡ Koda — Add Feature'));
      console.log(chalk.gray(`   ${description}`));
      if (generateTests) console.log(chalk.gray('   (includes test generation)'));
      console.log();

      if (!await configExists()) {
        console.error(chalk.red('✗ No AI config found. Run `koda login` first.\n'));
        process.exit(1);
      }

      let metrics: ProductMetrics | null = null;
      try {
        metrics = await ProductMetrics.load(rootPath);
        metrics.taskStart('add', description);
      } catch { /* non-fatal */ }

      try {
        const config    = await loadConfig();
        const provider  = new AzureAIProvider(config);
        const repoEnv   = await RepoContextAnalyzer.analyze(rootPath);
        const memory    = await GlobalMemoryStore.load(rootPath);
        const learner   = await LearningLoop.load(rootPath);
        const explainer = new Explainer({ enabled: !!options.explain });

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
          branch:    'add',
          rootPath,
          fileCount: filePaths.length,
        };

        const memHint    = memory.getContextHint(description);
        const repoCtx    = repoEnv.formatForPrompt();
        const systemHint = [repoCtx, memHint].filter(Boolean).join('\n\n');

        const basePrompt = [
          `Add the following feature to this codebase: ${description}`,
          generateTests ? 'Include unit tests for any new code you write.' : '',
          'Follow the existing code style, patterns, and conventions.',
          'Plan the implementation first, then execute file by file.',
          systemHint,
        ].filter(Boolean).join('\n\n');

        // ── Execute + verify loop ───────────────────────────────────────────
        let iteration    = 0;
        let succeeded    = false;
        let totalRetries = 0;
        let currentTask  = basePrompt;

        console.log(chalk.bold.cyan('── Planning & Implementing ─────────────────'));

        while (iteration <= maxIterations) {
          iteration++;

          if (iteration > 1) {
            console.log(chalk.bold.cyan(`\n── Fix Attempt ${iteration - 1} / ${maxIterations} ──`));
          }

          const engine = new ReasoningEngine(index, provider);
          try {
            await engine.chat(
              currentTask,
              chatContext,
              [],
              (_chunk: string) => { /* streaming chunk */ },
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

          // ── Verify ─────────────────────────────────────────────────────────
          console.log(chalk.gray('\n   ○ Running verification…'));
          const verifier  = new DagVerification(rootPath, {
            buildCmd: repoEnv.buildCommand ?? 'pnpm build',
            testCmd:  repoEnv.testCommand  ?? 'pnpm test',
          });
          const verResult  = await verifier.verify();
          const confidence = ConfidenceEngine.assessWithMemory(
            { retries: iteration - 1, verificationPassed: verResult.passed, isFixAttempt: iteration > 1 },
            description,
            memory,
          );

          console.log(chalk.gray(`   ○ ${ConfidenceEngine.formatStage(confidence)}`));

          if (verResult.passed) {
            console.log(chalk.green(`\n   ✓ Feature added and verified`));
            if (options.explain) {
              explainer.setConfidence(confidence);
              console.log(chalk.gray(explainer.format()));
            }
            succeeded = true;
            break;
          }

          if (iteration > maxIterations) break;

          totalRetries++;
          currentTask = [
            `The feature implementation had verification failures. Error:\n${verResult.summary}`,
            `Fix the issues. Original feature: ${description}`,
            systemHint,
          ].filter(Boolean).join('\n\n');

          learner.recordOutcome('feature_verification', 'iterative_fix', false);
          await learner.save();
        }

        // ── Result ──────────────────────────────────────────────────────────
        const durationMs = Date.now() - startTime;
        console.log();
        if (succeeded) {
          const secs = (durationMs / 1000).toFixed(1);
          console.log(chalk.bold.green(`✓ Done in ${secs}s`));
          if (totalRetries > 0) {
            console.log(chalk.gray(`  (Self-corrected ${totalRetries} time${totalRetries > 1 ? 's' : ''} — no manual intervention needed)`));
          }
          if (options.commit) {
            console.log(chalk.gray('  Review with `git diff`, then commit.'));
          }
          memory.recordTask({ description, succeeded: true, retries: totalRetries, durationMs, filesChanged: [] });
          learner.recordOutcome('feature_add', 'plan_and_execute', true);
        } else {
          console.log(chalk.bold.red('✗ Feature partially implemented — review the changes above.'));
          memory.recordTask({ description, succeeded: false, retries: totalRetries, durationMs, filesChanged: [] });
        }

        await Promise.all([memory.save(), learner.save()]);

        if (metrics) {
          metrics.taskComplete({ success: succeeded, retries: totalRetries, durationMs });
          await metrics.flush();
          const oneliner = metrics.formatOneLiner();
          if (oneliner) console.log(chalk.gray(`\n  ${oneliner}`));
        }

        if (succeeded) {
          console.log(
            chalk.gray('\n  🚀 Koda added this automatically.') +
            '\n' +
            chalk.gray('     If this saved you time → ') +
            chalk.blue('github.com/varunbiluri/koda') +
            '\n',
          );
        }

      } catch (err) {
        handleCliError(err);
        if (metrics) {
          metrics.taskComplete({ success: false, retries: 0 });
          await metrics.flush();
        }
      }
    });
}
