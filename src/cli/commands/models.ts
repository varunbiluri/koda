import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../../ai/config-store.js';
import { AzureAIProvider } from '../../ai/providers/azure-provider.js';
import { handleCliError } from '../errors.js';

export const modelsCommand = new Command('models')
  .description('List available AI models from Azure AI Foundry')
  .action(async () => {
    try {
      const config = await loadConfig();
      const provider = new AzureAIProvider(config);

      console.log(chalk.bold('\nFetching available models...\n'));

      const models = await provider.listModels();

      if (models.length === 0) {
        console.log(chalk.yellow('No models found.'));
        return;
      }

      console.log(chalk.bold('Available Models:\n'));

      for (const model of models) {
        const isCurrent = model.id === config.model;
        const marker = isCurrent ? chalk.green('✓') : ' ';
        console.log(`${marker} ${chalk.cyan(model.id)} ${chalk.gray(`(${model.name})`)}`);
      }

      console.log();
      console.log(chalk.gray(`Current model: ${config.model}`));
      console.log(chalk.gray('Use "koda use <model>" to switch models.\n'));
    } catch (err) {
      handleCliError(err);
    }
  });
