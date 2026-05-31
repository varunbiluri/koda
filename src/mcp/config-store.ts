import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { McpConfigFile, McpServerConfig } from './types.js';
import { logger } from '../utils/logger.js';

const EMPTY: McpConfigFile = { servers: {} };

export function getGlobalMcpPath(): string {
  return path.join(os.homedir(), '.koda', 'mcp.json');
}

export function getProjectMcpPath(rootPath: string): string {
  return path.join(rootPath, '.koda', 'mcp.json');
}

/** Load and merge global + project MCP configs (project overrides global). */
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

export async function saveGlobalMcpConfig(config: McpConfigFile): Promise<void> {
  const file = getGlobalMcpPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2), 'utf-8');
}

export async function addGlobalMcpServer(
  name: string,
  server: McpServerConfig,
): Promise<void> {
  const config = await loadMcpConfig(process.cwd());
  config.servers[name] = server;
  await saveGlobalMcpConfig(config);
}

export async function removeGlobalMcpServer(name: string): Promise<boolean> {
  const config = await loadMcpConfig(process.cwd());
  if (!config.servers[name]) return false;
  delete config.servers[name];
  await saveGlobalMcpConfig(config);
  return true;
}

export async function listConfiguredServers(rootPath: string): Promise<Record<string, McpServerConfig>> {
  const config = await loadMcpConfig(rootPath);
  return config.servers;
}
