import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { runIndexingPipeline } from '../../engine/indexing-pipeline.js';
import { handleCliError } from '../errors.js';

export const initCommand = new Command('init')
  .description('Index the current repository')
  .option('-f, --force', 'Force full re-index', false)
  .action(async (options: { force: boolean }) => {
    const spinner = ora('Indexing repository...').start();
    try {
      const rootPath = process.cwd();
      const result = await runIndexingPipeline(rootPath, {
        force: options.force,
        onProgress(stage: string) {
          spinner.text = stage;
        },
      });

      spinner.succeed(chalk.green('Indexing complete!'));
      console.log(`  Files: ${result.metadata.fileCount}`);
      console.log(`  Chunks: ${result.metadata.chunkCount}`);
      console.log(`  Dependencies: ${result.metadata.edgeCount}`);

      if (result.warnings.length > 0) {
        console.log(chalk.yellow(`\n  Warnings (${result.warnings.length}):`));
        for (const w of result.warnings.slice(0, 10)) {
          console.log(chalk.yellow(`    - ${w}`));
        }
        if (result.warnings.length > 10) {
          console.log(chalk.yellow(`    ... and ${result.warnings.length - 10} more`));
        }
      }
    } catch (err) {
      spinner.fail('Indexing failed');
      handleCliError(err);
    }
  });
