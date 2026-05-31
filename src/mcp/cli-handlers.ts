/**
 * Shared MCP CLI handlers — used by /mcp slash command and `koda mcp`.
 */

import chalk from 'chalk';
import { mcpManager } from './mcp-manager.js';
import {
  addGlobalMcpServer,
  getGlobalMcpPath,
  loadMcpConfig,
  removeGlobalMcpServer,
} from './config-store.js';

export interface McpCliCallbacks {
  info:  (message: string) => void;
  error: (message: string, hint?: string) => void;
}

/**
 * Dispatches an MCP CLI subcommand to the corresponding handler.
 *
 * @param args - CLI arguments where the first element selects the subcommand (defaults to "list" when absent).
 * @param rootPath - Filesystem root path used to initialize the MCP manager.
 * @param callbacks - Handlers for informational and error output to the console.
 */
export async function runMcpCommand(
  args: string[],
  rootPath: string,
  callbacks: McpCliCallbacks,
): Promise<void> {
  const sub = (args[0] ?? 'list').toLowerCase();
  mcpManager.setRootPath(rootPath);

  switch (sub) {
    case 'list':
    case 'status':
      await listMcpServers(rootPath, callbacks);
      return;

    case 'tools':
      await listMcpTools(rootPath, callbacks);
      return;

    case 'add':
      await addMcpServer(args, rootPath, callbacks);
      return;

    case 'remove':
    case 'rm':
      await removeMcpServer(args, callbacks);
      return;

    case 'reconnect':
      await reconnectMcpServers(rootPath, callbacks);
      return;

    default:
      callbacks.info('MCP commands: list | tools | add | remove | reconnect');
      console.log(chalk.gray('  koda mcp list'));
      console.log(chalk.gray('  koda mcp tools'));
      console.log(chalk.gray('  koda mcp add <name> <command> [args...]'));
      console.log(chalk.gray('  koda mcp remove <name>'));
      console.log(chalk.gray('  koda mcp reconnect'));
      console.log();
  }
}

/**
 * Display configured MCP servers and their connection status to the console.
 *
 * Prints the global MCP config path, shows a message and example usage if no servers are configured,
 * and otherwise lists each server with its connection state and tool count.
 *
 * @param rootPath - Filesystem root used to read MCP configuration and resolve server statuses
 * @param callbacks - Console callbacks used to emit informational or error messages
 */
async function listMcpServers(rootPath: string, callbacks: McpCliCallbacks): Promise<void> {
  const statuses = await mcpManager.getStatuses(rootPath);
  const config = await loadMcpConfig(rootPath);

  console.log();
  console.log(chalk.bold('  MCP Servers'));
  console.log(chalk.gray(`  Config: ${getGlobalMcpPath()}`));
  console.log();

  if (Object.keys(config.servers).length === 0) {
    callbacks.info('No MCP servers configured.');
    console.log(chalk.gray('  Add one: koda mcp add <name> <command> [args...]'));
    console.log(chalk.gray('  Example: koda mcp add fs npx -y @modelcontextprotocol/server-filesystem .'));
    console.log();
    return;
  }

  for (const s of statuses) {
    const status = s.connected
      ? chalk.green('connected')
      : chalk.yellow(s.error ?? 'disconnected');
    console.log(`  ${chalk.cyan(s.name.padEnd(16))} ${status}  ${chalk.gray(`${s.toolCount} tools`)}`);
  }
  console.log();
}

/**
 * Display available MCP tools across connected servers.
 *
 * Ensures the MCP manager is connected, prints a header with the total tool count, and lists up to the first 50 tools showing each tool's full name and a truncated description. If no tools are available an informational message is sent via the provided callbacks; if more than 50 tools exist a summary line indicates how many are omitted.
 *
 * @param rootPath - Filesystem root path used by the MCP manager
 * @param callbacks - Console callbacks for informational and error messages
 */
async function listMcpTools(rootPath: string, callbacks: McpCliCallbacks): Promise<void> {
  await mcpManager.ensureConnected(rootPath);
  const tools = await mcpManager.listAllTools(rootPath);

  console.log();
  console.log(chalk.bold(`  MCP Tools (${tools.length})`));
  console.log();

  if (tools.length === 0) {
    callbacks.info('No MCP tools available. Run `koda mcp reconnect` or add servers.');
    console.log();
    return;
  }

  for (const t of tools.slice(0, 50)) {
    console.log(`  ${chalk.cyan(t.fullName.padEnd(40))} ${chalk.gray(t.description.slice(0, 60))}`);
  }
  if (tools.length > 50) {
    console.log(chalk.gray(`  … and ${tools.length - 50} more`));
  }
  console.log();
}

/**
 * Add an MCP server to the global configuration and attempt to connect to it.
 *
 * If the provided arguments are insufficient, reports usage via `callbacks.error` and returns.
 * On successful save, reports confirmation via `callbacks.info`. Then attempts to connect:
 * - On successful connection, reports success via `callbacks.info`.
 * - On connection failure, reports the saved-but-failed status via `callbacks.error` with the error message.
 *
 * @param args - CLI arguments where `args[1]` is the server name, `args[2]` is the command, and `args.slice(3)` are command arguments
 * @param callbacks - Callbacks used to report informational and error messages
 */
async function addMcpServer(
  args: string[],
  _rootPath: string,
  callbacks: McpCliCallbacks,
): Promise<void> {
  if (args.length < 3) {
    callbacks.error('Usage: koda mcp add <name> <command> [args...]');
    return;
  }

  const name = args[1]!;
  const command = args[2]!;
  const mcpArgs = args.slice(3);

  await addGlobalMcpServer(name, { command, args: mcpArgs, enabled: true });
  callbacks.info(`Added MCP server "${name}"`);

  try {
    await mcpManager.connectServer(name, { command, args: mcpArgs });
    callbacks.info('Connected successfully.');
  } catch (err) {
    callbacks.error(`Saved but connect failed: ${(err as Error).message}`);
  }
  console.log();
}

/**
 * Removes an MCP server from global configuration and disconnects it if found.
 *
 * @param args - Command arguments; expects the server name at `args[1]`
 * @param callbacks - Console callbacks for informational and error messages
 */
async function removeMcpServer(args: string[], callbacks: McpCliCallbacks): Promise<void> {
  if (args.length < 2) {
    callbacks.error('Usage: koda mcp remove <name>');
    return;
  }

  const name = args[1]!;
  const removed = await removeGlobalMcpServer(name);
  if (removed) {
    await mcpManager.disconnectServer(name);
    callbacks.info(`Removed MCP server "${name}"`);
  } else {
    callbacks.error(`Server not found: ${name}`);
  }
  console.log();
}

/**
 * Disconnects all configured MCP servers and re-establishes connections using the given root path.
 *
 * @param rootPath - File-system root path used when connecting to MCP servers
 * @param callbacks - Console callbacks for informational and error messages; used to report reconnection success
 */
async function reconnectMcpServers(rootPath: string, callbacks: McpCliCallbacks): Promise<void> {
  await mcpManager.disconnectAll();
  await mcpManager.ensureConnected(rootPath);
  callbacks.info('MCP servers reconnected.');
  console.log();
}
