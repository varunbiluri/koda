import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, configExists, saveConfig } from '../../ai/config-store.js';
import { SessionManager } from '../session/session-manager.js';
import type { AIConfig } from '../../ai/types.js';

export function createConfigCommand(): Command {
  const configCmd = new Command('config')
    .description('Show or update Koda AI configuration');

  // koda config show
  configCmd
    .command('show')
    .description('Show current configuration')
    .action(async () => {
      const exists = await configExists();
      if (!exists) {
        console.log(chalk.yellow('\nNo configuration found. Run `koda config setup` to configure.\n'));
        return;
      }
      const config = await loadConfig();
      console.log();
      console.log(chalk.bold('  Koda Configuration'));
      console.log();
      console.log(`  ${chalk.gray('Provider:')}  ${config.provider}`);
      console.log(`  ${chalk.gray('Endpoint:')}  ${config.endpoint}`);
      console.log(`  ${chalk.gray('Model:')}     ${config.model}`);
      console.log(`  ${chalk.gray('API key:')}   ${maskKey(config.apiKey)}`);
      if (config.apiVersion) {
        console.log(`  ${chalk.gray('API ver:')}   ${config.apiVersion}`);
      }
      console.log();
    });

  // koda config setup
  configCmd
    .command('setup')
    .description('Run the interactive setup wizard')
    .action(async () => {
      const manager = new SessionManager();
      await manager.runSetupWizard();
    });

  // koda config set-model <model>
  configCmd
    .command('set-model <model>')
    .description('Update the deployment/model name')
    .action(async (model: string) => {
      const exists = await configExists();
      if (!exists) {
        console.log(chalk.red('\nNo configuration found. Run `koda config setup` first.\n'));
        process.exit(1);
      }
      const config = await loadConfig();
      const updated: AIConfig = { ...config, model };
      await saveConfig(updated);
      console.log(chalk.green(`\n  Model updated to: ${model}\n`));
    });

  // Default: show if config exists, otherwise setup
  configCmd.action(async () => {
    const exists = await configExists();
    if (exists) {
      const config = await loadConfig();
      console.log();
      console.log(chalk.bold('  Koda Configuration'));
      console.log();
      console.log(`  ${chalk.gray('Provider:')}  ${config.provider}`);
      console.log(`  ${chalk.gray('Endpoint:')}  ${config.endpoint}`);
      console.log(`  ${chalk.gray('Model:')}     ${config.model}`);
      console.log(`  ${chalk.gray('API key:')}   ${maskKey(config.apiKey)}`);
      console.log();
      console.log(chalk.gray('  Run `koda config setup` to reconfigure.'));
      console.log();
    } else {
      const manager = new SessionManager();
      await manager.runSetupWizard();
    }
  });

  return configCmd;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '***';
  return key.slice(0, 4) + '···' + key.slice(-4);
}
