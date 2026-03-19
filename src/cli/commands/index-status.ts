import { Command } from 'commander';
import { ShardManager } from '../../indexing/shard-manager.js';
import { join } from 'path';
import chalk from 'chalk';

export function createIndexStatusCommand(): Command {
  const indexStatus = new Command('index-status');

  indexStatus
    .description('Show indexing status and shard information')
    .option('--detailed', 'Show detailed shard information')
    .action(async (options) => {
      console.log(chalk.blue('\n📊 Koda Index Status\n'));

      try {
        const kodaDir = join(process.cwd(), '.koda');
        const shardManager = new ShardManager(kodaDir);

        await shardManager.initialize();

        const stats = shardManager.getStatistics();
        const shards = shardManager.getAllShards();

        console.log(chalk.bold('Index Overview:\n'));
        console.log(`Shard count: ${stats.shardCount}`);
        console.log(`Total files: ${stats.totalFiles}`);
        console.log(`Avg files/shard: ${Math.round(stats.avgFilesPerShard)}`);
        console.log(`Largest shard: ${stats.largestShard} files`);
        console.log(`Smallest shard: ${stats.smallestShard} files`);
        console.log('');

        if (options.detailed && shards.length > 0) {
          console.log(chalk.bold('Shard Details:\n'));

          for (const shard of shards) {
            console.log(chalk.cyan(`${shard.id}:`));
            console.log(`  Files: ${shard.fileCount}`);
            console.log(`  Size: ${(shard.totalSize / (1024 * 1024)).toFixed(2)} MB`);
            console.log(`  Created: ${new Date(shard.createdAt).toLocaleString()}`);
            console.log(`  Updated: ${new Date(shard.updatedAt).toLocaleString()}`);
            console.log('');
          }
        }

        console.log(chalk.green('✓ Done\n'));
      } catch (error) {
        console.error(chalk.red(`\n✗ Error: ${(error as Error).message}\n`));
        // Non-fatal: render error and return control to caller.
        return;
      }
    });

  return indexStatus;
}
