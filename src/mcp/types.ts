/**
 * MCP (Model Context Protocol) configuration types.
 * Compatible with Claude Code–style mcp.json layout.
 */

export interface McpServerConfig {
  /** Executable to spawn (e.g. "npx", "node"). */
  command: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Extra environment variables for the server process. */
  env?: Record<string, string>;
  /** When false, server is skipped at connect time. */
  enabled?: boolean;
}

export interface McpConfigFile {
  /** Named MCP servers keyed by alias. */
  servers: Record<string, McpServerConfig>;
}

export interface McpServerStatus {
  name:      string;
  connected: boolean;
  toolCount: number;
  error?:    string;
}

export interface McpToolDescriptor {
  server:      string;
  name:        string;
  description: string;
  /** Full tool id exposed to the LLM: mcp__server__tool */
  fullName:    string;
  /** JSON Schema for tool arguments (from MCP server). */
  inputSchema?: Record<string, unknown>;
}
