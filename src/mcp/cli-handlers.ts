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

/** Run an MCP subcommand (list|tools|add|remove|reconnect). */
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

async function reconnectMcpServers(rootPath: string, callbacks: McpCliCallbacks): Promise<void> {
  await mcpManager.disconnectAll();
  await mcpManager.ensureConnected(rootPath);
  callbacks.info('MCP servers reconnected.');
  console.log();
}
