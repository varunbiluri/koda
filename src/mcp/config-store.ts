import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { McpConfigFile, McpServerConfig } from './types.js';
import { logger } from '../utils/logger.js';

const EMPTY: McpConfigFile = { servers: {} };

/**
 * Resolves the filesystem path to the global MCP configuration file located in the user's home directory.
 *
 * @returns The absolute path to the global MCP config file (typically `<homedir>/.koda/mcp.json`).
 */
export function getGlobalMcpPath(): string {
  return path.join(os.homedir(), '.koda', 'mcp.json');
}

/**
 * Compute the path to the project MCP configuration file.
 *
 * @param rootPath - The project root directory
 * @returns The path to the project's MCP config file, i.e. `<rootPath>/.koda/mcp.json`
 */
export function getProjectMcpPath(rootPath: string): string {
  return path.join(rootPath, '.koda', 'mcp.json');
}

/**
 * Loads MCP configuration from the global and project config files, merging server entries so project entries override global ones.
 *
 * @param rootPath - Project root used to locate the project MCP config
 * @returns The merged MCP config whose `servers` map contains combined entries from the global config then the project config
 */
export async function loadMcpConfig(rootPath: string): Promise<McpConfigFile> {
  const merged: McpConfigFile = { servers: {} };

  for (const file of [getGlobalMcpPath(), getProjectMcpPath(rootPath)]) {
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const parsed = JSON.parse(raw) as McpConfigFile;
      if (parsed.servers) {
        Object.assign(merged.servers, parsed.servers);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`[mcp] Failed to read ${file}: ${(err as Error).message}`);
      }
    }
  }

  return merged;
}

/**
 * Persist the given MCP configuration to the global config file (~/.koda/mcp.json).
 *
 * @param config - The configuration to save; will replace the contents of the global MCP config file
 */
export async function saveGlobalMcpConfig(config: McpConfigFile): Promise<void> {
  const file = getGlobalMcpPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Add or replace a server entry in the global MCP configuration.
 *
 * @param name - The identifier used as the server entry key
 * @param server - The server configuration to store under `name`
 */
export async function addGlobalMcpServer(
  name: string,
  server: McpServerConfig,
): Promise<void> {
  const config = await loadMcpConfig(process.cwd());
  config.servers[name] = server;
  await saveGlobalMcpConfig(config);
}

/**
 * Remove a server entry from the global MCP configuration and persist the change.
 *
 * @param name - The key/name of the server to remove from the global config
 * @returns `true` if the server existed and was removed, `false` otherwise.
 */
export async function removeGlobalMcpServer(name: string): Promise<boolean> {
  const config = await loadMcpConfig(process.cwd());
  if (!config.servers[name]) return false;
  delete config.servers[name];
  await saveGlobalMcpConfig(config);
  return true;
}

/**
 * Retrieve the configured MCP servers for a given project root.
 *
 * @param rootPath - Filesystem path to the project root used to load project-specific configuration
 * @returns A record mapping server names to their `McpServerConfig` objects
 */
export async function listConfiguredServers(rootPath: string): Promise<Record<string, McpServerConfig>> {
  const config = await loadMcpConfig(rootPath);
  return config.servers;
}
