import { Command } from 'commander';
import { SessionManager } from '../session/session-manager.js';

/**
 * Create a configured `chat` CLI command that starts an interactive agent session (REPL).
 *
 * When executed, the command instantiates a SessionManager and starts a session using the current working directory.
 *
 * @returns A `Command` instance named `chat` which, when invoked, starts the interactive agent session.
 */
export function createChatCommand(): Command {
  return new Command('chat')
    .description('Start interactive agent session (REPL)')
    .action(async () => {
      const session = new SessionManager();
      await session.start(process.cwd());
    });
}
