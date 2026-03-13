import { Command } from 'commander';
import { VerificationEngine } from '../../evaluation/verification-engine.js';
import { loadIndex } from '../../store/index-store.js';
import { agentRegistry } from '../../orchestrator/agent-registry.js';
import chalk from 'chalk';
import ora from 'ora';

export function createDoctorCommand(): Command {
  const doctor = new Command('doctor');

  doctor
    .description('Run health check on project and Koda installation')
    .option('--skip-tests', 'Skip running tests')
    .option('--skip-build', 'Skip building project')
    .action(async (options) => {
      console.log(chalk.bold('\n🏥 Koda Doctor - Health Check\n'));

      const spinner = ora();

      // Check 1: Koda index
      spinner.start('Checking Koda index...');
      try {
        const index = await loadIndex(process.cwd());
        spinner.succeed(
          `Index found: ${index.files.length} files, ${index.chunks.length} chunks`
        );
      } catch (err) {
        spinner.warn('No index found - run "koda init" to create one');
      }

      // Check 2: Agent registry
      spinner.start('Checking agent registry...');
      const agentCount = agentRegistry.getAgentCount();
      const categories = agentRegistry.getCategories();
      spinner.succeed(`${agentCount} agents registered across ${categories.length} categories`);

      // Check 3: Verification
      if (!options.skipTests && !options.skipBuild) {
        spinner.start('Running verification suite...');
        const verificationEngine = new VerificationEngine();

        try {
          const result = await verificationEngine.verify(process.cwd());

          if (result.success) {
            spinner.succeed('All verifications passed');
          } else {
            spinner.fail('Verification failed');
            console.log(chalk.bold('\n  Results:'));
            console.log(`    Type Check: ${result.typeCheckPassed ? '✓' : '✗'}`);
            console.log(`    Build: ${result.buildPassed ? '✓' : '✗'}`);
            console.log(`    Lint: ${result.lintPassed ? '✓' : '✗'}`);
            console.log(`    Tests: ${result.testsPassed ? '✓' : '✗'}`);

            if (result.errors.length > 0) {
              console.log(chalk.bold('\n  Errors:'));
              for (const error of result.errors.slice(0, 5)) {
                console.log(chalk.red(`    - ${error}`));
              }
              if (result.errors.length > 5) {
                console.log(chalk.gray(`    ... and ${result.errors.length - 5} more`));
              }
            }
          }
        } catch (err) {
          spinner.warn(`Verification skipped: ${(err as Error).message}`);
        }
      }

      // Summary
      console.log(chalk.bold('\n✅ Health check complete!\n'));
    });

  return doctor;
}
