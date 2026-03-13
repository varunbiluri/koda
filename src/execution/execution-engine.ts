import { WorkspaceMemory } from '../memory/workspace-memory.js';
import { AgentOrchestrator, type OrchestrationResult } from '../orchestrator/agent-orchestrator.js';
import type { AgentOutput } from '../agents/types.js';
import { loadIndex } from '../store/index-store.js';
import { gitDiff, gitStatus } from '../tools/git-tools.js';
import { VerificationEngine } from '../evaluation/verification-engine.js';
import { ExecutionTracker, executionTracker } from '../observability/execution-tracker.js';
import { ExecutionHistoryStore } from '../memory/history/execution-history-store.js';
import { LearningEngine } from '../memory/history/learning-engine.js';
import { AgentBudgetManager, defaultBudgetConfig } from '../budget/agent-budget-manager.js';
import { FileLockManager } from '../locks/file-lock-manager.js';
import type { ExecutionRecord } from '../memory/history/types.js';
import type { BudgetConfig } from '../budget/types.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import { join } from 'path';

export interface ExecutionOptions {
  autoCommit?: boolean;
  dryRun?: boolean;
  skipTests?: boolean;
  maxIterations?: number;
  verifyEachIteration?: boolean;
  budgetConfig?: BudgetConfig;
  learnFromHistory?: boolean;
}

export interface ExecutionReport {
  success: boolean;
  summary: string;
  filesModified: string[];
  gitDiff?: string;
  errors: string[];
  warnings: string[];
  logs: string[];
  iterations: number;
  verificationAttempts: number;
  totalTokensUsed: number;
  duration: number;
}

export class ExecutionEngine {
  private orchestrator: AgentOrchestrator;
  private verificationEngine: VerificationEngine;
  private tracker: ExecutionTracker;
  private historyStore: ExecutionHistoryStore | null = null;
  private learningEngine: LearningEngine | null = null;
  private budgetManager: AgentBudgetManager;
  private lockManager: FileLockManager;

  constructor(kodaDir?: string) {
    this.orchestrator = new AgentOrchestrator();
    this.verificationEngine = new VerificationEngine();
    this.tracker = executionTracker;
    this.budgetManager = new AgentBudgetManager(defaultBudgetConfig);
    this.lockManager = new FileLockManager();

    if (kodaDir) {
      this.historyStore = new ExecutionHistoryStore(kodaDir);
      this.learningEngine = new LearningEngine(this.historyStore);
    }
  }

  async execute(
    userTask: string,
    rootPath: string,
    options: ExecutionOptions = {},
  ): Promise<ExecutionReport> {
    const maxIterations = options.maxIterations || 3;
    const verifyEachIteration = options.verifyEachIteration !== false;

    // Apply budget config if provided
    if (options.budgetConfig) {
      this.budgetManager.updateConfig(options.budgetConfig);
    }

    // Start tracking
    this.tracker.start();

    // Create workspace memory
    const memory = new WorkspaceMemory(rootPath, userTask);
    memory.info('Execution engine started with iterative verification', 'engine');

    // Learn from history if enabled
    if (options.learnFromHistory && this.learningEngine) {
      const suggestedAgents = await this.learningEngine.getSuggestedAgents(userTask);
      if (suggestedAgents.length > 0) {
        memory.info(`Learning suggests agents: ${suggestedAgents.join(', ')}`, 'learning');
      }

      const pitfalls = await this.learningEngine.getCommonPitfalls('general');
      if (pitfalls.length > 0) {
        memory.info(`Common pitfalls to avoid: ${pitfalls.length} identified`, 'learning');
      }
    }

    try {
      // Load repository index
      const repoIndex = await loadIndex(rootPath);
      memory.setRepoIndex(repoIndex);
      memory.info(`Loaded index: ${repoIndex.files.length} files, ${repoIndex.chunks.length} chunks`, 'engine');

      let iteration = 0;
      let lastResult: OrchestrationResult | null = null;
      let verificationAttempts = 0;
      const allErrors: string[] = [];
      const allWarnings: string[] = [];

      // Iterative execution loop
      while (iteration < maxIterations) {
        iteration++;
        this.tracker.recordIteration(iteration, false);

        logger.info(`\n[ExecutionEngine] Starting iteration ${iteration}/${maxIterations}`);
        memory.info(`Starting iteration ${iteration}`, 'engine');

        // Execute orchestration
        lastResult = await this.orchestrator.orchestrate(userTask, memory);

        // Track results
        for (const output of lastResult.outputs) {
          this.tracker.recordAgentCompletion(output.agentName, output.success);
        }

        // Track file modifications
        for (const file of lastResult.filesModified) {
          this.tracker.recordFileModification(file);
        }

        // Collect errors
        if (lastResult.errors.length > 0) {
          allErrors.push(...lastResult.errors);
        }

        // Verify if requested
        if (verifyEachIteration && !options.dryRun) {
          verificationAttempts++;
          this.tracker.recordVerificationStart();

          logger.info('[ExecutionEngine] Running verification...');
          const verificationResult = await this.verificationEngine.verify(rootPath);

          if (verificationResult.success) {
            logger.info('[ExecutionEngine] Verification passed!');
            this.tracker.recordVerificationResult(true);
            this.tracker.recordIteration(iteration, true);
            memory.info('Verification passed', 'verification');
            break; // Success!
          } else {
            logger.warn(`[ExecutionEngine] Verification failed (attempt ${verificationAttempts})`);
            this.tracker.recordVerificationResult(false, verificationResult.errors);
            memory.warn(`Verification failed: ${verificationResult.errors.length} errors`, 'verification');

            allErrors.push(...verificationResult.errors);
            allWarnings.push(...verificationResult.warnings);

            // Check if we should continue
            if (iteration >= maxIterations) {
              logger.error('[ExecutionEngine] Max iterations reached');
              break;
            }

            // Add verification errors to context for next iteration
            memory.info(`Retrying with ${verificationResult.errors.length} errors to fix`, 'engine');
          }
        } else {
          // No verification, assume success
          this.tracker.recordIteration(iteration, true);
          break;
        }
      }

      // Finish tracking
      const metrics = this.tracker.finish();

      // Generate git diff if files were modified
      let diff: string | undefined;
      if (lastResult && lastResult.filesModified.length > 0) {
        const diffResult = await gitDiff(rootPath);
        if (diffResult.success) {
          diff = diffResult.data;
        }
      }

      // Create execution report
      const report = this.createEnhancedReport(
        lastResult!,
        memory,
        diff,
        iteration,
        verificationAttempts,
        allErrors,
        allWarnings,
        metrics.totalDuration
      );

      // Save execution history
      if (this.historyStore) {
        const record: ExecutionRecord = {
          id: `exec-${Date.now()}`,
          timestamp: new Date(),
          task: userTask,
          success: report.success,
          agentsUsed: lastResult?.outputs.map((o: AgentOutput) => o.agentName) || [],
          filesModified: report.filesModified,
          errors: allErrors,
          warnings: allWarnings,
          verificationAttempts,
          totalTokensUsed: metrics.tokenUsage,
          duration: metrics.totalDuration,
        };

        await this.historyStore.saveRecord(record);
        logger.info('[ExecutionEngine] Execution record saved to history');
      }

      // Clear locks
      this.lockManager.clearAllLocks();

      memory.info('Execution completed', 'engine');
      logger.info(`[ExecutionEngine] Completed in ${iteration} iterations`);

      return report;
    } catch (err) {
      const metrics = this.tracker.finish();

      memory.error(`Execution failed: ${(err as Error).message}`, 'engine');

      this.lockManager.clearAllLocks();

      return {
        success: false,
        summary: `Execution failed: ${(err as Error).message}`,
        filesModified: [],
        errors: [(err as Error).message],
        warnings: [],
        logs: memory.getExecutionLogs().map((l) => `[${l.level}] ${l.message}`),
        iterations: 0,
        verificationAttempts: 0,
        totalTokensUsed: metrics.tokenUsage,
        duration: metrics.totalDuration,
      };
    }
  }

  private createEnhancedReport(
    result: OrchestrationResult,
    memory: WorkspaceMemory,
    gitDiff: string | undefined,
    iterations: number,
    verificationAttempts: number,
    allErrors: string[],
    allWarnings: string[],
    duration: number
  ): ExecutionReport {
    const logs = memory.getExecutionLogs().map((l) => `[${l.level}] ${l.message}`);
    const summary = memory.getSummary();
    const metrics = this.tracker.getMetrics();

    const fullSummary = `
${result.summary}

Agent Summary:
- Total agents: ${summary.totalAgents}
- Successful: ${summary.successfulAgents}
- Failed: ${summary.failedAgents}
- Tools used: ${summary.toolsUsed}

Execution Metrics:
- Iterations: ${iterations}
- Verification attempts: ${verificationAttempts}
- Files modified: ${result.filesModified.length}
- Duration: ${(duration / 1000).toFixed(2)}s
- Token usage: ${metrics.tokenUsage.toLocaleString()}
`.trim();

    return {
      success: result.success && allErrors.length === 0,
      summary: fullSummary,
      filesModified: result.filesModified,
      gitDiff,
      errors: allErrors,
      warnings: allWarnings,
      logs,
      iterations,
      verificationAttempts,
      totalTokensUsed: metrics.tokenUsage,
      duration,
    };
  }

  // Safety check: preview changes before applying
  async previewChanges(userTask: string, rootPath: string): Promise<string> {
    const report = await this.execute(userTask, rootPath, { dryRun: true, maxIterations: 1 });

    let preview = chalk.bold('\n=== Execution Preview ===\n\n');
    preview += `Task: ${userTask}\n\n`;
    preview += `Files to be modified (${report.filesModified.length}):\n`;

    for (const file of report.filesModified) {
      preview += chalk.cyan(`  - ${file}\n`);
    }

    if (report.gitDiff) {
      preview += chalk.bold('\n=== Git Diff ===\n');
      preview += report.gitDiff;
    }

    if (report.warnings.length > 0) {
      preview += chalk.bold('\n=== Warnings ===\n');
      for (const warning of report.warnings) {
        preview += chalk.yellow(`  - ${warning}\n`);
      }
    }

    if (report.errors.length > 0) {
      preview += chalk.bold('\n=== Errors ===\n');
      for (const error of report.errors) {
        preview += chalk.red(`  - ${error}\n`);
      }
    }

    preview += chalk.bold('\n=== Metrics ===\n');
    preview += `Duration: ${(report.duration / 1000).toFixed(2)}s\n`;
    preview += `Token usage: ${report.totalTokensUsed.toLocaleString()}\n`;

    return preview;
  }

  // Get detailed execution report
  getDetailedReport(): string {
    return this.tracker.formatDetailedReport();
  }

  // Reset execution state
  reset(): void {
    this.tracker.reset();
    this.budgetManager.resetAllBudgets();
    this.lockManager.clearAllLocks();
  }
}
