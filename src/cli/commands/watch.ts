import { Command } from 'commander';
import { WatcherService } from '../../watcher/repo-watcher.js';
import { BackgroundAgentManager } from '../../background/background-agent-manager.js';

export function createWatchCommand(): Command {
  return new Command('watch')
    .description('Watch repository for changes and run background agents')
    .option('--root <path>', 'Repository root path', process.cwd())
    .action(async (options: { root: string }) => {
      const rootPath = options.root;
      const agentManager = new BackgroundAgentManager(rootPath);
      const watcher = new WatcherService(rootPath);

      watcher.getDispatcher().on('file-changed', async (event) => {
        await agentManager.trigger('onFileSave', [event.filePath]);
      });

      watcher.getDispatcher().on('file-created', async (event) => {
        await agentManager.trigger('onFileSave', [event.filePath]);
      });

      agentManager.on('result', (result) => {
        console.log(`[${result.agentName}] ${result.analysis}`);
      });

      console.log(`Watching repository: ${rootPath}`);
      console.log('Press Ctrl+C to stop.\n');

      watcher.start();

      process.on('SIGINT', () => {
        watcher.stop();
        process.exit(0);
      });

      // Keep process alive
      await new Promise<void>(() => {});
    });
}
