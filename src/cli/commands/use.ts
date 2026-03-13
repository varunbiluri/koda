import { Command } from 'commander';
import chalk from 'chalk';
import { updateModel } from '../../ai/config-store.js';
import { handleCliError } from '../errors.js';

export const useCommand = new Command('use')
  .description('Switch to a different AI model')
  .argument('<model>', 'Model name or deployment ID')
  .action(async (model: string) => {
    try {
      await updateModel(model);
      console.log(chalk.green(`\n✓ Switched to model: ${chalk.bold(model)}\n`));
    } catch (err) {
      handleCliError(err);
    }
  });
