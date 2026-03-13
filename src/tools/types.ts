export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  execute(...args: unknown[]): Promise<ToolResult>;
}
