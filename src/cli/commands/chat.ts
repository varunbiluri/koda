import { Command } from 'commander';
import { SessionManager } from '../session/session-manager.js';

/**
 * `koda chat` — launch the interactive agent session (same as running `koda` with no args).
 * Claude Code–style: terminal-first, natural language + slash commands.
 */
export function createChatCommand(): Command {
  return new Command('chat')
    .description('Start interactive agent session (REPL)')
    .action(async () => {
      const session = new SessionManager();
      await session.start(process.cwd());
    });
}
