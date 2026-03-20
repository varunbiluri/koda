import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { runIndexingPipeline } from '../../engine/indexing-pipeline.js';
import { ArchitectureAgentMd } from '../../agents/architecture-agent.js';
import { handleCliError } from '../errors.js';
import { OnboardingWizard } from '../../onboarding/onboarding-wizard.js';
import { ProductMetrics } from '../../product/metrics.js';

export const initCommand = new Command('init')
  .description('Index the current repository')
  .option('-f, --force', 'Force full re-index', false)
  .action(async (options: { force: boolean }) => {
    const rootPath   = process.cwd();
    const isFirst    = await OnboardingWizard.isFirstRun(rootPath);
    const spinner    = ora('Indexing repository...').start();

    try {
      const result = await runIndexingPipeline(rootPath, {
        force: options.force,
        onProgress(stage: string) {
          spinner.text = stage;
        },
      });

      spinner.succeed(chalk.green('Repository indexed'));
      console.log(`  Files:        ${result.metadata.fileCount}`);
      console.log(`  Chunks:       ${result.metadata.chunkCount}`);
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

      // ── Generate AGENTS.md ──────────────────────────────────────────────────
      const analyzeSpinner = ora('Analyzing architecture...').start();
      try {
        const agent = new ArchitectureAgentMd();
        const report = agent.analyze(result.index);
        analyzeSpinner.succeed(chalk.green('Architecture analyzed'));

        const writeSpinner = ora('Generating AGENTS.md...').start();
        await agent.writeAgentsMd(rootPath, report.agentsMd);
        writeSpinner.succeed(chalk.green('AGENTS.md generated'));
      } catch (analyzeErr) {
        analyzeSpinner.fail(chalk.yellow('Architecture analysis failed (non-critical)'));
        console.log(chalk.gray(`  ${(analyzeErr as Error).message}`));
      }

      // ── First-run onboarding wizard ─────────────────────────────────────────
      if (isFirst) {
        const wizard  = new OnboardingWizard(rootPath);
        const profile = await wizard.detectProfile(result.metadata.fileCount);
        await wizard.printWelcome(profile);
        await OnboardingWizard.markOnboarded(rootPath);
      } else {
        // Returning user: show brief metrics
        try {
          const metrics = await ProductMetrics.load(rootPath);
          const oneliner = metrics.formatOneLiner();
          if (oneliner) console.log(chalk.gray(`\n  ${oneliner}`));
        } catch { /* non-fatal */ }
        console.log(chalk.gray('\n  Ready. Run `koda fix`, `koda add`, or `koda ask`.\n'));
      }

    } catch (err) {
      spinner.fail('Indexing failed');
      handleCliError(err);
    }
  });
