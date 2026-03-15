import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { TestAgent } from '../../agents/test-agent.js';
import { handleCliError } from '../errors.js';

export function createTestGenCommand(): Command {
  return new Command('test')
    .description('Scan for untested functions and generate Vitest test scaffolding')
    .option('--dry-run', 'Show what would be generated without writing files')
    .action(async (options: { dryRun?: boolean }) => {
      const spinner = ora('Scanning for untested functions...').start();

      try {
        const rootPath = process.cwd();

        if (options.dryRun) {
          const agent = new TestAgent(rootPath);
          // @ts-ignore — access private for dry-run preview
          const sourceFiles: string[] = await (agent as any).collectSourceFiles();
          // @ts-ignore
          const untested = await (agent as any).findUntested(sourceFiles);
          spinner.stop();
          console.log();
          console.log(chalk.bold(`Would generate tests for ${untested.length} function(s):`));
          for (const fn of untested) {
            console.log(chalk.gray(`  • ${fn.file}:${fn.startLine} → ${fn.name}`));
          }
          console.log();
          return;
        }

        const agent = new TestAgent(rootPath);
        const result = await agent.run();
        spinner.stop();

        console.log();
        console.log(
          chalk.bold(`Detected ${result.untestedFunctions.length} untested function(s)`),
        );
        console.log();
        console.log('Generating tests...');
        console.log();

        if (result.generatedFiles.length === 0) {
          console.log(chalk.gray('  No new test files needed.'));
        } else {
          for (const f of result.generatedFiles) {
            console.log(`  ${chalk.green('✔')} ${f}`);
          }
        }
        console.log();

        if (result.testsPassed) {
          console.log(chalk.green('  ✔ Tests passed'));
        } else {
          console.log(chalk.yellow('  ⚠ Some tests failed — review generated files'));
        }
        console.log();
      } catch (err) {
        spinner.fail('Test generation failed');
        handleCliError(err);
      }
    });
}
