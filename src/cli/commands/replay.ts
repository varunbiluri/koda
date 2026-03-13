import { Command } from 'commander';
import { ExecutionHistoryStore } from '../../memory/history/execution-history-store.js';
import { LearningEngine } from '../../memory/history/learning-engine.js';
import { ExecutionEngine } from '../../execution/execution-engine.js';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';

export function createReplayCommand(): Command {
  const replay = new Command('replay');

  replay
    .description('Replay a past execution')
    .argument('<execution-id>', 'ID of execution to replay')
    .option('--with-suggestions', 'Apply learning suggestions from history')
    .option('--dry-run', 'Preview without making changes')
    .action(async (executionId: string, options) => {
      const kodaDir = join(process.cwd(), '.koda');
      const historyStore = new ExecutionHistoryStore(kodaDir);
      const learningEngine = new LearningEngine(historyStore);

      const spinner = ora();

      try {
        // Load execution record
        spinner.start('Loading execution record...');
        const record = await historyStore.getRecordById(executionId);

        if (!record) {
          spinner.fail(`Execution ${executionId} not found`);
          process.exit(1);
        }

        spinner.succeed(`Loaded execution: ${record.task}`);

        // Show original execution details
        console.log(chalk.bold('\n📼 Replaying Execution\n'));
        console.log(`Original Date: ${record.timestamp.toLocaleString()}`);
        console.log(`Task: ${record.task}`);
        console.log(`Original Result: ${record.success ? chalk.green('Success') : chalk.red('Failed')}`);
        console.log(`Duration: ${(record.duration / 1000).toFixed(2)}s`);
        console.log(`Tokens Used: ${record.totalTokensUsed.toLocaleString()}`);
        console.log(`Agents Used: ${record.agentsUsed.join(', ')}`);

        // Get learning suggestions if requested
        if (options.withSuggestions) {
          spinner.start('Analyzing learning suggestions...');

          const insights = await learningEngine.generateInsights();
          const taskInsights = insights.filter(i =>
            i.pattern.toLowerCase().includes(record.task.toLowerCase())
          );

          if (taskInsights.length > 0) {
            spinner.succeed(`Found ${taskInsights.length} learning suggestions`);
            console.log(chalk.bold('\n💡 Learning Suggestions:\n'));

            for (const insight of taskInsights.slice(0, 3)) {
              console.log(`  ${chalk.cyan(insight.pattern)}`);
              console.log(`  → ${insight.recommendation}`);
              console.log(`  Confidence: ${(insight.confidence * 100).toFixed(0)}%\n`);
            }
          } else {
            spinner.info('No specific suggestions for this task type');
          }
        }

        // Execute replay
        console.log(chalk.bold('\n▶️  Starting Replay...\n'));

        const executionEngine = new ExecutionEngine(kodaDir);

        const executionOptions = {
          dryRun: options.dryRun,
          learnFromHistory: options.withSuggestions,
          maxIterations: 3,
        };

        spinner.start('Executing task...');

        const report = await executionEngine.execute(
          record.task,
          process.cwd(),
          executionOptions
        );

        if (report.success) {
          spinner.succeed('Replay completed successfully');
        } else {
          spinner.fail('Replay failed');
        }

        // Show comparison
        console.log(chalk.bold('\n📊 Comparison\n'));
        console.log(`Original: ${record.success ? chalk.green('Success') : chalk.red('Failed')} | Replay: ${report.success ? chalk.green('Success') : chalk.red('Failed')}`);
        console.log(`Original Duration: ${(record.duration / 1000).toFixed(2)}s | Replay: ${(report.duration / 1000).toFixed(2)}s`);
        console.log(`Original Tokens: ${record.totalTokensUsed.toLocaleString()} | Replay: ${report.totalTokensUsed.toLocaleString()}`);

        if (options.dryRun) {
          console.log(chalk.yellow('\n[DRY RUN] No changes were made\n'));
        } else {
          console.log(chalk.bold(`\nFiles Modified: ${report.filesModified.length}`));
          for (const file of report.filesModified) {
            console.log(chalk.cyan(`  - ${file}`));
          }
        }

        if (report.errors.length > 0) {
          console.log(chalk.bold('\nErrors:'));
          for (const error of report.errors.slice(0, 5)) {
            console.log(chalk.red(`  - ${error}`));
          }
        }

        console.log('');
      } catch (err) {
        spinner.fail(`Replay failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return replay;
}
