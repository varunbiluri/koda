import { Command } from 'commander';
import { WorkerManager } from '../../distributed/worker-manager.js';
import chalk from 'chalk';

export function createWorkersCommand(): Command {
  const workers = new Command('workers');

  workers
    .description('Show distributed worker status')
    .option('--list', 'List all workers')
    .action(async (options) => {
      console.log(chalk.blue('\n⚙️  Koda Workers\n'));

      try {
        const manager = new WorkerManager();

        const stats = manager.getStatistics();

        console.log(chalk.bold('Worker Statistics:\n'));
        console.log(`Total workers: ${stats.totalWorkers}`);
        console.log(`Idle: ${chalk.green(stats.idleWorkers.toString())}`);
        console.log(`Busy: ${chalk.yellow(stats.busyWorkers.toString())}`);
        console.log(`Offline: ${chalk.red(stats.offlineWorkers.toString())}`);
        console.log('');

        console.log(chalk.bold('Task Queue:\n'));
        console.log(`Queued: ${stats.queuedTasks}`);
        console.log(`Completed: ${stats.completedTasks}`);
        console.log('');

        if (options.list) {
          const allWorkers = manager.getWorkers();

          if (allWorkers.length > 0) {
            console.log(chalk.bold('Worker List:\n'));

            for (const worker of allWorkers) {
              const statusColor =
                worker.status === 'idle' ? chalk.green :
                worker.status === 'busy' ? chalk.yellow :
                chalk.red;

              console.log(`${worker.id} - ${statusColor(worker.status)}`);
              console.log(`  Tasks completed: ${worker.tasksCompleted}`);
              console.log(`  Last heartbeat: ${new Date(worker.lastHeartbeat).toLocaleString()}`);

              if (worker.currentTask) {
                console.log(`  Current task: ${worker.currentTask}`);
              }

              console.log('');
            }
          } else {
            console.log(chalk.yellow('No workers registered\n'));
          }
        }

        console.log(chalk.green('✓ Done\n'));
      } catch (error) {
        console.error(chalk.red(`\n✗ Error: ${(error as Error).message}\n`));
        process.exit(1);
      }
    });

  return workers;
}
