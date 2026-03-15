import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ReviewAgent } from '../../agents/review-agent.js';
import { handleCliError } from '../errors.js';

export function createReviewCommand(): Command {
  return new Command('review')
    .description('Analyze the repository for code quality issues and security risks')
    .option('--errors-only', 'Only show errors, not warnings or info')
    .action(async (options: { errorsOnly?: boolean }) => {
      const spinner = ora('Scanning repository...').start();

      try {
        const rootPath = process.cwd();
        const agent = new ReviewAgent(rootPath);
        const report = await agent.run();
        spinner.stop();

        console.log();
        console.log(chalk.bold(`Reviewed ${report.filesReviewed} files`));
        console.log();

        if (report.issues.length === 0) {
          console.log(chalk.green('  ✔ No issues found'));
          console.log();
          return;
        }

        // Group by file
        const byFile = new Map<string, typeof report.issues>();
        for (const issue of report.issues) {
          if (options.errorsOnly && issue.severity !== 'error') continue;
          const list = byFile.get(issue.file) ?? [];
          list.push(issue);
          byFile.set(issue.file, list);
        }

        for (const [file, issues] of byFile) {
          console.log(chalk.bold(`  ${file}`));
          for (const issue of issues) {
            const icon =
              issue.severity === 'error'
                ? chalk.red('✗')
                : issue.severity === 'warning'
                ? chalk.yellow('⚠')
                : chalk.gray('i');
            const loc = issue.line ? chalk.gray(`:${issue.line}`) : '';
            console.log(`    ${icon} ${issue.message}${loc}`);
          }
          console.log();
        }

        const errors = report.issues.filter((i) => i.severity === 'error').length;
        const warnings = report.issues.filter((i) => i.severity === 'warning').length;
        console.log(
          chalk.gray(
            `  ${errors} error(s), ${warnings} warning(s), ${report.issues.length - errors - warnings} info`,
          ),
        );
        console.log();
      } catch (err) {
        spinner.fail('Review failed');
        handleCliError(err);
      }
    });
}
