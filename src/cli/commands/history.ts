import { Command } from 'commander';
import { ExecutionHistoryStore } from '../../memory/history/execution-history-store.js';
import { join } from 'path';
import chalk from 'chalk';

export function createHistoryCommand(): Command {
  const history = new Command('history');

  history
    .description('View execution history')
    .option('-n, --limit <number>', 'Number of records to show', '10')
    .option('--stats', 'Show statistics only')
    .option('--task <query>', 'Filter by task description')
    .option('--success', 'Show only successful executions')
    .option('--failed', 'Show only failed executions')
    .action(async (options) => {
      const kodaDir = join(process.cwd(), '.koda');
      const historyStore = new ExecutionHistoryStore(kodaDir);

      try {
        if (options.stats) {
          // Show statistics
          const stats = await historyStore.getStatistics();

          console.log(chalk.bold('\n📊 Execution History Statistics\n'));
          console.log(`Total Executions: ${stats.totalExecutions}`);
          console.log(`Success Rate: ${(stats.successRate * 100).toFixed(1)}%`);
          console.log(`Average Duration: ${(stats.averageDuration / 1000).toFixed(2)}s`);
          console.log(`Total Tokens Used: ${stats.totalTokensUsed.toLocaleString()}`);

          if (stats.mostUsedAgents.length > 0) {
            console.log(chalk.bold('\nMost Used Agents:'));
            for (const { agent, count } of stats.mostUsedAgents.slice(0, 5)) {
              console.log(`  ${agent}: ${count} times`);
            }
          }

          if (stats.mostModifiedFiles.length > 0) {
            console.log(chalk.bold('\nMost Modified Files:'));
            for (const { file, count } of stats.mostModifiedFiles.slice(0, 5)) {
              console.log(`  ${file}: ${count} times`);
            }
          }
        } else {
          // Show execution records
          let records;

          if (options.task) {
            records = await historyStore.getRecordsByTask(options.task, parseInt(options.limit));
          } else if (options.success) {
            records = await historyStore.getSuccessfulRecords(parseInt(options.limit));
          } else if (options.failed) {
            records = await historyStore.getFailedRecords(parseInt(options.limit));
          } else {
            records = await historyStore.getRecentRecords(parseInt(options.limit));
          }

          if (records.length === 0) {
            console.log(chalk.yellow('\nNo execution history found\n'));
            return;
          }

          console.log(chalk.bold('\n📜 Execution History\n'));

          for (const record of records) {
            const status = record.success ? chalk.green('✓') : chalk.red('✗');
            const date = record.timestamp.toLocaleString();
            const duration = (record.duration / 1000).toFixed(2);

            console.log(`${status} ${chalk.bold(record.id)} - ${date}`);
            console.log(`  Task: ${record.task}`);
            console.log(`  Duration: ${duration}s | Tokens: ${record.totalTokensUsed.toLocaleString()}`);
            console.log(`  Agents: ${record.agentsUsed.join(', ')}`);
            console.log(`  Files: ${record.filesModified.length} modified`);

            if (record.errors.length > 0) {
              console.log(chalk.red(`  Errors: ${record.errors.length}`));
            }

            console.log('');
          }
        }
      } catch (err) {
        console.error(chalk.red(`\nError loading history: ${(err as Error).message}\n`));
        process.exit(1);
      }
    });

  return history;
}
