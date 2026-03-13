import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'node:readline';
import { ExecutionEngine } from '../../execution/execution-engine.js';
import { handleCliError } from '../errors.js';

function confirmAction(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.yellow(question + ' (y/N): '), (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

export const buildCommand = new Command('build')
  .description('Execute a complex development task using AI agents')
  .argument('<task>', 'Development task to execute')
  .option('--preview', 'Preview changes without executing')
  .option('--auto-commit', 'Automatically commit changes')
  .option('--skip-tests', 'Skip test execution')
  .action(async (task: string, options: { preview?: boolean; autoCommit?: boolean; skipTests?: boolean }) => {
    const spinner = ora('Initializing execution engine...').start();

    try {
      const rootPath = process.cwd();
      const engine = new ExecutionEngine();

      if (options.preview) {
        spinner.stop();
        const preview = await engine.previewChanges(task, rootPath);
        console.log(preview);
        return;
      }

      // Confirm before execution
      spinner.stop();
      console.log(chalk.bold(`\nTask: ${chalk.cyan(task)}\n`));

      const confirmed = await confirmAction(
        'This will modify files in your repository. Continue?'
      );

      if (!confirmed) {
        console.log(chalk.yellow('Execution cancelled.'));
        return;
      }

      spinner.start('Executing task...');

      const report = await engine.execute(task, rootPath, {
        autoCommit: options.autoCommit,
        skipTests: options.skipTests,
      });

      spinner.stop();

      // Display results
      if (report.success) {
        console.log(chalk.green('\n✓ Task completed successfully!\n'));
      } else {
        console.log(chalk.red('\n✗ Task completed with errors\n'));
      }

      console.log(chalk.bold('Summary:\n'));
      console.log(report.summary);

      if (report.filesModified.length > 0) {
        console.log(chalk.bold('\nModified Files:\n'));
        for (const file of report.filesModified) {
          console.log(chalk.cyan(`  - ${file}`));
        }
      }

      if (report.gitDiff) {
        console.log(chalk.bold('\nGit Diff:\n'));
        console.log(report.gitDiff.split('\n').slice(0, 50).join('\n'));
        if (report.gitDiff.split('\n').length > 50) {
          console.log(chalk.gray('  ... (truncated, run git diff for full output)'));
        }
      }

      if (report.errors.length > 0) {
        console.log(chalk.bold('\nErrors:\n'));
        for (const error of report.errors) {
          console.log(chalk.red(`  - ${error}`));
        }
      }

      console.log();
    } catch (err) {
      spinner.fail('Execution failed');
      handleCliError(err);
    }
  });
