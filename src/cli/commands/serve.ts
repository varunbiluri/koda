import { Command } from 'commander';
import chalk from 'chalk';
import { ServeServer } from '../../serve/http-server.js';

export function createServeCommand(): Command {
  return new Command('serve')
    .description('Start HTTP server for Koda desktop/mobile apps (Codex-style agent UI)')
    .option('--root <path>', 'Repository root path', process.cwd())
    .option('--host <host>', 'Bind address', '127.0.0.1')
    .option('--port <port>', 'Port number', '8787')
    .option('--token <token>', 'Auth token (random if omitted)')
    .action(async (options: { root: string; host: string; port: string; token?: string }) => {
      const port = Number.parseInt(options.port, 10);
      if (!Number.isFinite(port) || port <= 0) {
        console.error(chalk.red('Invalid port'));
        process.exit(1);
      }

      const server = new ServeServer({
        rootPath: options.root,
        host: options.host,
        port,
        token: options.token,
      });

      await server.start();
      const { host, port: boundPort } = server.getAddress();
      const token = server.getAuthToken();

      console.log(chalk.cyan('Koda serve running'));
      console.log(chalk.gray(`  URL:   http://${host}:${boundPort}`));
      console.log(chalk.gray(`  Token: ${token}`));
      console.log(chalk.gray('  Connect desktop or iOS companion with this token.'));
      console.log();

      const shutdown = async () => {
        await server.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}
