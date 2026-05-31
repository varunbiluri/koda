import { Command } from 'commander';
import chalk from 'chalk';
import { UIRenderer } from '../session/ui-renderer.js';
import { runProviderSetup } from '../../ai/providers/provider-setup.js';
import { handleCliError } from '../errors.js';

export const loginCommand = new Command('login')
  .description('Configure AI provider (Azure, OpenAI, Anthropic, or Ollama)')
  .action(async () => {
    try {
      const ui = new UIRenderer();
      const ok = await runProviderSetup(ui);
      if (ok) {
        console.log(chalk.green('\n✓ Configuration saved successfully!\n'));
      }
    } catch (err) {
      handleCliError(err);
    }
  });
