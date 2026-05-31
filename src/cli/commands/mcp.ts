import { Command } from 'commander';
import chalk from 'chalk';
import { runMcpCommand } from '../../mcp/cli-handlers.js';

/**
 * Create the top-level `mcp` CLI command for managing MCP servers.
 *
 * The returned command is configured with colored informational and error callbacks
 * and includes these subcommands: `list` (alias `status`), `tools`, `add <name> <command...>`,
 * `remove <name>` (alias `rm`), and `reconnect`. Invoking `mcp` without a subcommand
 * defaults to listing servers.
 *
 * @returns A Commander `Command` instance configured for the `mcp` command and its subcommands
 */
export function createMcpCommand(): Command {
  const mcpCmd = new Command('mcp')
    .description('Manage MCP servers (Claude Code–style)');

  const callbacks = {
    info:  (message: string) => console.log(chalk.blue(`  ℹ ${message}`)),
    error: (message: string, hint?: string) => {
      console.log(chalk.red(`  ✗ ${message}`));
      if (hint) console.log(chalk.gray(`    ${hint}`));
    },
  };

  mcpCmd
    .command('list')
    .aliases(['status'])
    .description('List configured MCP servers and connection status')
    .action(async () => {
      await runMcpCommand(['list'], process.cwd(), callbacks);
    });

  mcpCmd
    .command('tools')
    .description('List tools exposed by connected MCP servers')
    .action(async () => {
      await runMcpCommand(['tools'], process.cwd(), callbacks);
    });

  mcpCmd
    .command('add <name> <command...>')
    .description('Add and connect an MCP server')
    .action(async (name: string, commandParts: string[]) => {
      const command = commandParts[0] ?? '';
      const mcpArgs = commandParts.slice(1);
      await runMcpCommand(['add', name, command, ...mcpArgs], process.cwd(), callbacks);
    });

  mcpCmd
    .command('remove <name>')
    .aliases(['rm'])
    .description('Remove an MCP server from config')
    .action(async (name: string) => {
      await runMcpCommand(['remove', name], process.cwd(), callbacks);
    });

  mcpCmd
    .command('reconnect')
    .description('Disconnect and reconnect all MCP servers')
    .action(async () => {
      await runMcpCommand(['reconnect'], process.cwd(), callbacks);
    });

  // Default: list servers
  mcpCmd.action(async () => {
    await runMcpCommand(['list'], process.cwd(), callbacks);
  });

  return mcpCmd;
}
