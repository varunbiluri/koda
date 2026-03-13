import { Command } from 'commander';
import chalk from 'chalk';
import { loadIndexMetadata } from '../../store/index-store.js';
import { handleCliError } from '../errors.js';

export const statusCommand = new Command('status')
  .description('Show index status and statistics')
  .action(async () => {
    try {
      const rootPath = process.cwd();
      const meta = await loadIndexMetadata(rootPath);

      console.log(chalk.bold('\nKoda Index Status\n'));
      console.log(`  Root:         ${meta.rootPath}`);
      console.log(`  Version:      ${meta.version}`);
      console.log(`  Indexed at:   ${meta.createdAt}`);
      console.log(`  Files:        ${meta.fileCount}`);
      console.log(`  Chunks:       ${meta.chunkCount}`);
      console.log(`  Dependencies: ${meta.edgeCount}`);
      console.log();
    } catch (err) {
      handleCliError(err);
    }
  });
