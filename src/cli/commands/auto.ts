/**
 * koda auto <task>
 *
 * Safe autonomous execution mode — runs a task, verifies the result, and
 * automatically loops to fix failures until success or a smart stop condition
 * is triggered.
 *
 * Safety gates (Parts 5 & 6):
 *   - Stops when confidence is LOW (unless --unsafe)
 *   - Stops when no-progress is detected (same error fingerprint twice)
 *   - Stops after N iterations (--max-iterations, default 3)
 *   - Requires explicit approval for HIGH-impact writes (unless --force)
 *   - Emits a full explanation report (--explain)
 *
 * Flags:
 *   --max-iterations <n>        Max fix→verify loops (default: 3)
 *   --no-verify                 Skip post-execution verification
 *   --dry-run                   Plan only, do not execute
 *   --explain                   Print detailed reasoning after each iteration
 *   --unsafe                    Continue even when confidence is LOW
 *   --force                     Auto-approve HIGH-impact writes without prompt
 *   --min-confidence <level>    Minimum confidence to continue (LOW|MEDIUM|HIGH, default LOW)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { configExists, loadConfig } from '../../ai/config-store.js';
import { AzureAIProvider } from '../../ai/providers/azure-provider.js';
import { ReasoningEngine } from '../../ai/reasoning/reasoning-engine.js';
import { DagVerification } from '../../intelligence/dag-verification.js';
import { RepoContextAnalyzer } from '../../intelligence/repo-context-analyzer.js';
import { GlobalMemoryStore } from '../../intelligence/global-memory-store.js';
import { LearningLoop } from '../../intelligence/learning-loop.js';
import { ConfidenceEngine, type ConfidenceLevel } from '../../intelligence/confidence-engine.js';
import { Explainer } from '../../intelligence/explainer.js';
import { RepoGraph } from '../../intelligence/repo-graph.js';
import { ImpactAnalyzer } from '../../intelligence/impact-analyzer.js';
import { failureAnalyzer } from '../../execution/failure-analyzer.js';
import { loadIndexMetadata } from '../../store/index-store.js';
import { handleCliError } from '../errors.js';
import { logger } from '../../utils/logger.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 3;

// ── Smart-stop helpers ─────────────────────────────────────────────────────────

/**
 * Fingerprints an error string so we can detect repeated identical failures
 * (no-progress condition). Uses the first 120 chars normalised to lowercase.
 */
function errorFingerprint(error: string): string {
  return error.toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

function minConfidenceOrder(level: ConfidenceLevel): number {
  return level === 'HIGH' ? 2 : level === 'MEDIUM' ? 1 : 0;
}

// ── Command ────────────────────────────────────────────────────────────────────

export function createAutoCommand(): Command {
  return new Command('auto')
    .description('Run a task autonomously: execute → verify → fix until success')
    .argument('<task>', 'Task to perform autonomously')
    .option('-n, --max-iterations <n>', 'Maximum fix→verify loops', String(DEFAULT_MAX_ITERATIONS))
    .option('--no-verify',          'Skip post-execution verification')
    .option('--dry-run',            'Print the plan without executing')
    .option('--explain',            'Print detailed reasoning after each iteration')
    .option('--unsafe',             'Continue even when confidence is LOW')
    .option('--force',              'Auto-approve HIGH-impact writes without prompting')
    .option('--min-confidence <level>', 'Minimum confidence to continue (LOW|MEDIUM|HIGH)', 'LOW')
    .action(async (task: string, options: {
      maxIterations:  string;
      verify:         boolean;
      dryRun?:        boolean;
      explain?:       boolean;
      unsafe?:        boolean;
      force?:         boolean;
      minConfidence:  string;
    }) => {
      const rootPath       = process.cwd();
      const maxIterations  = Math.max(1, parseInt(options.maxIterations ?? String(DEFAULT_MAX_ITERATIONS), 10));
      const doVerify       = options.verify !== false;
      const minConfidence  = (options.minConfidence?.toUpperCase() ?? 'LOW') as ConfidenceLevel;

      console.log(chalk.bold.blue('\n⚡ Koda Auto Mode\n'));
      console.log(chalk.gray(`Task:             ${task}`));
      console.log(chalk.gray(`Max iterations:   ${maxIterations}`));
      console.log(chalk.gray(`Verify:           ${doVerify ? 'yes' : 'no'}`));
      console.log(chalk.gray(`Min confidence:   ${minConfidence}`));
      console.log(chalk.gray(`Explain:          ${options.explain ? 'yes' : 'no'}`));
      console.log(chalk.gray(`Safe mode:        ${options.unsafe ? 'OFF (--unsafe)' : 'ON'}`));
      console.log();

      if (options.dryRun) console.log(chalk.yellow('--dry-run: planning only (no writes)\n'));

      if (!await configExists()) {
        console.error(chalk.red('No AI config found. Run `koda login` to configure.\n'));
        process.exit(1);
      }

      try {
        const config      = await loadConfig();
        const provider    = new AzureAIProvider(config);
        const repoEnv     = await RepoContextAnalyzer.analyze(rootPath);
        const memory      = await GlobalMemoryStore.load(rootPath);
        const learner     = await LearningLoop.load(rootPath);
        const explainer   = new Explainer({ enabled: !!options.explain });

        // Load index (non-fatal)
        let index = null;
        try {
          const meta = await loadIndexMetadata(rootPath);
          if (meta) {
            const { loadIndex } = await import('../../store/index-store.js');
            index = await loadIndex(rootPath);
          }
        } catch { /* no index — continue */ }

        // Build repo graph for impact analysis
        const filePaths  = index?.chunks.map((c: { filePath: string }) => c.filePath) ?? [];
        const repoGraph  = await RepoGraph.build(rootPath, [...new Set(filePaths)]);
        const impactAnal = new ImpactAnalyzer(rootPath, repoGraph);

        const chatContext = {
          repoName:  path.basename(rootPath),
          branch:    'auto',
          rootPath,
          fileCount: 0,
        };

        const memHint   = memory.getContextHint(task);
        explainer.recordPlan(
          'auto mode (ReasoningEngine.chat)',
          'Single-agent autonomous execution with iterative verification',
          ['COMPLEX path (GraphScheduler) — not used in CLI auto mode'],
        );

        let currentTask     = task;
        let iteration       = 0;
        let succeeded       = false;
        let lastError       = '';
        let sameErrorCount  = 0;
        const seenFingerprints = new Set<string>();
        const startTime     = Date.now();

        // ── Auto loop ───────────────────────────────────────────────────────
        while (iteration < maxIterations) {
          iteration++;
          const iterStart = Date.now();
          console.log(chalk.bold(`\n── Iteration ${iteration} / ${maxIterations} ──`));
          console.log(chalk.cyan(`▶ ${currentTask.slice(0, 120)}\n`));

          if (options.dryRun) {
            console.log(chalk.yellow('(dry-run) Would execute task via ReasoningEngine.chat()'));
            succeeded = true;
            break;
          }

          // ── Part 6: Smart stop — confidence gate ──────────────────────────
          if (!options.unsafe && iteration > 1) {
            const preScore = ConfidenceEngine.assessWithMemory(
              { retries: iteration - 1, isFixAttempt: iteration > 1 },
              task,
              memory,
            );
            if (minConfidenceOrder(preScore.level) > minConfidenceOrder(minConfidence)) {
              // Always passes LOW (0 > 0 is false), but MEDIUM/HIGH thresholds apply
            }
            if (preScore.level === 'LOW' && !options.unsafe && minConfidence !== 'LOW') {
              console.log(chalk.red(`\n🔴 Confidence is LOW — stopping (use --unsafe to override)`));
              console.log(chalk.gray(preScore.reasoning));
              break;
            }
          }

          // ── Execute ───────────────────────────────────────────────────────
          const engine     = new ReasoningEngine(index, provider);
          let   taskOutput = '';
          const filesWritten: string[] = [];

          const systemHint = memHint
            ? `${memHint}\n\n---\n\n${currentTask}`
            : currentTask;

          try {
            await engine.chat(
              systemHint,
              chatContext,
              [],
              (chunk) => {
                taskOutput += chunk;
                process.stdout.write(chunk);
              },
              (stage) => {
                if (stage.startsWith('WARN')) {
                  process.stderr.write(chalk.yellow(`  ${stage}\n`));
                } else if (stage.startsWith('INFO CACHE_HIT')) {
                  process.stderr.write(chalk.gray(`  ↩ cache: ${stage.slice(14)}\n`));
                }
              },
              undefined,
              undefined,
              undefined,
              undefined, // signal
              undefined,
              // ── Part 5: Safe auto mode — impact-aware diff approval ────────
              async (filePath: string, oldContent: string, newContent: string) => {
                filesWritten.push(filePath);

                // Run impact analysis on the file being written
                const impactReport = impactAnal.analyze(filePath);

                if (impactReport.level === 'HIGH' && !options.force) {
                  // Even in auto mode, HIGH-impact changes require confirmation
                  console.log('\n' + chalk.yellow(impactAnal.formatBlock(impactReport)));
                  const answer = await promptYN(`Write to ${path.relative(rootPath, filePath)}? [y/N] `);
                  if (!answer) {
                    console.log(chalk.gray('  ↩ skipped by user'));
                    return false;
                  }
                } else if (impactReport.level === 'MEDIUM') {
                  console.log(chalk.gray(`  ⚠ MEDIUM impact: ${impactReport.summary}`));
                }

                logger.debug(`[auto] Writing ${filePath} (${impactReport.level} impact)`);
                return true;
              },
            );
          } catch (execErr) {
            console.error(chalk.red(`\n✗ Execution error: ${(execErr as Error).message}`));
          }

          console.log('\n');
          explainer.recordIteration(Date.now() - iterStart);

          // ── Verify ────────────────────────────────────────────────────────
          if (!doVerify) {
            succeeded = true;
            break;
          }

          console.log(chalk.gray('Verifying…'));
          const verifier  = new DagVerification(rootPath, {
            buildCmd: repoEnv.buildCommand,
            testCmd:  repoEnv.testCommand,
          });
          const verResult = await verifier.verify({
            onStage: (msg) => {
              if (msg.includes('PASSED'))       console.log(chalk.green(`  ✔ ${msg.replace('INFO VERIFY ', '')}`));
              else if (msg.includes('FAILED'))  console.log(chalk.red(`  ✗ ${msg.replace('INFO VERIFY ', '')}`));
              else                              console.log(chalk.gray(`  ${msg}`));
            },
          });

          // ── Confidence assessment ─────────────────────────────────────────
          const impactForTask = impactAnal.analyze(filesWritten);
          const confidence    = ConfidenceEngine.assessWithMemory(
            {
              retries:            iteration - 1,
              verificationPassed: verResult.passed,
              impactLevel:        impactForTask.level,
              isFixAttempt:       iteration > 1,
            },
            task,
            memory,
          );
          explainer.setConfidence(confidence);
          console.log(chalk.gray(ConfidenceEngine.formatStage(confidence)));

          if (options.explain) {
            console.log(chalk.gray(ConfidenceEngine.formatReport(confidence)));
          }

          if (verResult.passed) {
            console.log(chalk.green(`\n✔ Verification passed (${verResult.summary})\n`));
            learner.recordOutcome('verification', currentTask.slice(0, 60), true);

            // Record semantic pattern from success
            memory.recordSemanticPattern(
              task.slice(0, 120),
              'Task completed successfully',
              currentTask.slice(0, 120),
              `Succeeded on iteration ${iteration}`,
              iteration === 1 ? 'first_try_success' : `retry_${iteration}_success`,
            );

            succeeded = true;
            break;
          }

          console.log(chalk.yellow(`\n⚠ Verification failed: ${verResult.summary}`));

          // Record failure in learner
          for (const check of verResult.checks.filter((c) => !c.passed)) {
            learner.recordOutcome(
              check.analysis?.type ?? 'unknown',
              `iteration_${iteration}`,
              false,
            );
            if (check.analysis) {
              explainer.recordFix(
                check.analysis.type,
                check.analysis.fixPrompt.slice(0, 80),
                [],
                learner.getBestStrategy(check.analysis.type) ? 'learned' : 'default',
              );
              // Record semantic pattern from failure
              memory.recordSemanticPattern(
                `${check.name} failure: ${check.analysis.type}`,
                check.analysis.summary,
                check.analysis.fixPrompt.slice(0, 200),
                `FailureAnalyzer confidence: ${(check.analysis.confidence * 100).toFixed(0)}%`,
                `${check.analysis.type} → ${check.name}_failure`,
              );
            }
          }

          // ── Part 6: Smart stop — no-progress detection ────────────────────
          const currentErrorFP = errorFingerprint(verResult.summary);
          if (seenFingerprints.has(currentErrorFP)) {
            sameErrorCount++;
            if (sameErrorCount >= 2) {
              console.log(chalk.red(`\n🔴 No progress detected — same error seen ${sameErrorCount + 1} times. Stopping.`));
              console.log(chalk.gray(`  Error: ${verResult.summary}`));
              break;
            }
          } else {
            seenFingerprints.add(currentErrorFP);
            sameErrorCount = 0;
          }
          lastError = verResult.summary;

          // ── Part 5: Safe auto — confidence LOW stop ───────────────────────
          if (confidence.level === 'LOW' && !options.unsafe) {
            console.log(chalk.red(`\n🔴 Confidence is LOW after iteration ${iteration} — stopping.`));
            console.log(chalk.gray(`  Use --unsafe to force continuation.`));
            console.log(chalk.gray(`  ${confidence.reasoning}`));
            break;
          }

          if (iteration >= maxIterations) {
            console.log(chalk.red(`\n✗ Max iterations (${maxIterations}) reached — giving up\n`));
            break;
          }

          // ── Generate fix task ─────────────────────────────────────────────
          const fixAnalysis = failureAnalyzer.classify(verResult.summary);
          const learnedStrat = learner.getBestStrategy(fixAnalysis.type);
          const fixTask = verifier.buildFixPrompt(verResult);
          currentTask   = learnedStrat
            ? `[Use this strategy first: ${learnedStrat}]\n\n${fixTask}`
            : fixTask;

          console.log(chalk.yellow(`\n⟳ Retrying with fix task (attempt ${iteration + 1})…\n`));
        }

        // ── Explain output ────────────────────────────────────────────────
        if (options.explain) {
          console.log('\n' + explainer.format());
        }

        // ── Record to global memory ───────────────────────────────────────
        const elapsed = Date.now() - startTime;
        memory.recordTask({
          description:  task.slice(0, 120),
          succeeded,
          durationMs:   elapsed,
          filesChanged: [],
          retries:      Math.max(0, iteration - 1),
        });
        await Promise.all([memory.save(), learner.save()]);

        // ── Summary ───────────────────────────────────────────────────────
        const icon   = succeeded ? chalk.green('✔') : chalk.red('✗');
        const status = succeeded ? 'succeeded' : 'failed';
        console.log(`${icon} Auto task ${status} after ${iteration} iteration${iteration !== 1 ? 's' : ''} (${(elapsed / 1000).toFixed(1)}s)\n`);
        process.exit(succeeded ? 0 : 1);

      } catch (err) {
        handleCliError(err);
        process.exit(1);
      }
    });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Prompt the user for a yes/no answer (returns true on 'y'/'Y'). */
async function promptYN(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
