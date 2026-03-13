import { Command } from 'commander';
import { LspServer } from '../../lsp/server.js';

export function createStartLspCommand(): Command {
  return new Command('start-lsp')
    .description('Start the Koda LSP server (communicates over stdio)')
    .option('--root <path>', 'Repository root path', process.cwd())
    .action(async (options: { root: string }) => {
      const server = new LspServer(options.root);
      await server.start();
    });
}
