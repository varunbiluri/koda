/**
 * McpManager — connects to configured MCP servers and exposes their tools
 * to the Koda agent loop (Claude Code–style MCP integration).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinitionForAI } from '../ai/types.js';
import { VERSION } from '../constants.js';
import { loadMcpConfig } from './config-store.js';
import type { McpServerConfig, McpServerStatus, McpToolDescriptor } from './types.js';
import { logger } from '../utils/logger.js';

const MCP_TOOL_PREFIX = 'mcp__';

interface ConnectedServer {
  client: Client;
  config: McpServerConfig;
}

export class McpManager {
  private readonly connections = new Map<string, ConnectedServer>();
  private rootPath = process.cwd();

  /** Parse mcp__serverName__toolName */
  static parseMcpToolName(fullName: string): { server: string; tool: string } | null {
    if (!fullName.startsWith(MCP_TOOL_PREFIX)) return null;
    const rest = fullName.slice(MCP_TOOL_PREFIX.length);
    const sep = rest.indexOf('__');
    if (sep <= 0) return null;
    return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
  }

  static toMcpToolName(server: string, tool: string): string {
    return `${MCP_TOOL_PREFIX}${server}__${tool}`;
  }

  setRootPath(rootPath: string): void {
    this.rootPath = rootPath;
  }

  async disconnectAll(): Promise<void> {
    for (const name of [...this.connections.keys()]) {
      await this.disconnectServer(name);
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;
    try {
      await conn.client.close();
    } catch {
      // ignore
    }
    this.connections.delete(name);
    logger.debug(`[mcp] Disconnected server "${name}"`);
  }

  async connectServer(name: string, config: McpServerConfig): Promise<void> {
    if (config.enabled === false) return;

    if (this.connections.has(name)) {
      await this.connections.get(name)!.client.close().catch(() => {});
      this.connections.delete(name);
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args:    config.args ?? [],
      env:     { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
      stderr:  'pipe',
    });

    const client = new Client(
      { name: 'koda', version: VERSION },
      { capabilities: {} },
    );

    await client.connect(transport);
    this.connections.set(name, { client, config });
    logger.debug(`[mcp] Connected server "${name}"`);
  }

  async ensureConnected(rootPath?: string): Promise<void> {
    if (rootPath) this.rootPath = rootPath;
    const config = await loadMcpConfig(this.rootPath);

    for (const [name, serverConfig] of Object.entries(config.servers)) {
      if (serverConfig.enabled === false) continue;
      if (this.connections.has(name)) continue;
      try {
        await this.connectServer(name, serverConfig);
      } catch (err) {
        logger.warn(`[mcp] Failed to connect "${name}": ${(err as Error).message}`);
      }
    }
  }

  async getStatuses(rootPath?: string): Promise<McpServerStatus[]> {
    if (rootPath) this.rootPath = rootPath;
    const config = await loadMcpConfig(this.rootPath);
    const statuses: McpServerStatus[] = [];

    for (const [name, serverConfig] of Object.entries(config.servers)) {
      if (serverConfig.enabled === false) {
        statuses.push({ name, connected: false, toolCount: 0, error: 'disabled' });
        continue;
      }

      const conn = this.connections.get(name);
      if (!conn) {
        statuses.push({ name, connected: false, toolCount: 0, error: 'not connected' });
        continue;
      }

      try {
        const tools = await conn.client.listTools();
        statuses.push({ name, connected: true, toolCount: tools.tools.length });
      } catch (err) {
        statuses.push({
          name,
          connected: false,
          toolCount: 0,
          error: (err as Error).message,
        });
      }
    }

    return statuses;
  }

  async listAllTools(rootPath?: string): Promise<McpToolDescriptor[]> {
    await this.ensureConnected(rootPath);
    const out: McpToolDescriptor[] = [];

    for (const [serverName, conn] of this.connections) {
      try {
        const { tools } = await conn.client.listTools();
        for (const t of tools) {
          out.push({
            server:      serverName,
            name:        t.name,
            description: t.description ?? '',
            fullName:    McpManager.toMcpToolName(serverName, t.name),
            inputSchema: t.inputSchema as Record<string, unknown> | undefined,
          });
        }
      } catch (err) {
        logger.warn(`[mcp] listTools failed for "${serverName}": ${(err as Error).message}`);
      }
    }

    return out;
  }

  async getToolDefinitions(rootPath?: string): Promise<ToolDefinitionForAI[]> {
    const descriptors = await this.listAllTools(rootPath);
    return descriptors.map((d) => ({
      type: 'function' as const,
      function: {
        name:        d.fullName,
        description: `[MCP:${d.server}] ${d.description || d.name}`,
        parameters:  d.inputSchema ?? {
          type:       'object',
          properties: {},
          required:   [],
        },
      },
    }));
  }

  async callTool(fullName: string, args: Record<string, unknown>): Promise<string> {
    const parsed = McpManager.parseMcpToolName(fullName);
    if (!parsed) return `Error: invalid MCP tool name "${fullName}"`;

    await this.ensureConnected(this.rootPath);
    const conn = this.connections.get(parsed.server);
    if (!conn) {
      return `Error: MCP server "${parsed.server}" is not connected. Run /mcp reconnect.`;
    }

    try {
      const result = await conn.client.callTool({
        name:      parsed.tool,
        arguments: args,
      });

      const parts = (result.content ?? []) as Array<{ type?: string; text?: string }>;
      const text = parts
        .map((p) => (p.type === 'text' ? p.text ?? '' : JSON.stringify(p)))
        .join('\n');

      return text || JSON.stringify(result);
    } catch (err) {
      return `Error calling MCP tool ${parsed.tool}: ${(err as Error).message}`;
    }
  }

  isMcpTool(toolName: string): boolean {
    return toolName.startsWith(MCP_TOOL_PREFIX);
  }
}

/** Process-wide MCP manager (session-scoped connections). */
export const mcpManager = new McpManager();
