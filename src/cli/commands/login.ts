import { Command } from 'commander';
import * as readline from 'node:readline';
import chalk from 'chalk';
import { saveConfig } from '../../ai/config-store.js';
import type { AIConfig } from '../../ai/types.js';
import { handleCliError } from '../errors.js';

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export const loginCommand = new Command('login')
  .description('Configure AI provider credentials')
  .action(async () => {
    try {
      console.log(chalk.bold('\nKoda AI Configuration\n'));

      const endpoint = await prompt('Azure AI Foundry Endpoint: ');
      const apiKey = await prompt('Azure API Key: ');
      const model = await prompt('Default Model (e.g., gpt-4): ');

      if (!endpoint || !apiKey || !model) {
        console.log(chalk.red('All fields are required.'));
        process.exit(1);
      }

      const config: AIConfig = {
        provider: 'azure',
        endpoint,
        apiKey,
        model,
      };

      await saveConfig(config);

      console.log(chalk.green('\n✓ Configuration saved successfully!'));
      console.log(chalk.gray(`Model: ${model}`));
      console.log(chalk.gray(`Endpoint: ${endpoint}\n`));
    } catch (err) {
      handleCliError(err);
    }
  });
