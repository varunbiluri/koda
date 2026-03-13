import type { RepoIndex } from '../types/index.js';
import type { AgentOutput } from '../agents/types.js';

export interface ToolResult {
  tool: string;
  timestamp: Date;
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface ExecutionLog {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: Date;
  agent?: string;
}

export class WorkspaceMemory {
  private taskContext: Record<string, unknown> = {};
  private agentOutputs: Map<string, AgentOutput> = new Map();
  private toolResults: ToolResult[] = [];
  private executionLogs: ExecutionLog[] = [];
  private repoIndex?: RepoIndex;

  constructor(
    public readonly rootPath: string,
    public readonly userTask: string,
  ) {}

  // Task context
  setContext(key: string, value: unknown): void {
    this.taskContext[key] = value;
  }

  getContext<T = unknown>(key: string): T | undefined {
    return this.taskContext[key] as T | undefined;
  }

  getAllContext(): Record<string, unknown> {
    return { ...this.taskContext };
  }

  // Repository index
  setRepoIndex(index: RepoIndex): void {
    this.repoIndex = index;
  }

  getRepoIndex(): RepoIndex | undefined {
    return this.repoIndex;
  }

  // Agent outputs
  recordAgentOutput(output: AgentOutput): void {
    this.agentOutputs.set(output.agentName, output);
  }

  getAgentOutput(agentName: string): AgentOutput | undefined {
    return this.agentOutputs.get(agentName);
  }

  getAllAgentOutputs(): AgentOutput[] {
    return Array.from(this.agentOutputs.values());
  }

  getSuccessfulOutputs(): AgentOutput[] {
    return this.getAllAgentOutputs().filter((o) => o.success);
  }

  getFailedOutputs(): AgentOutput[] {
    return this.getAllAgentOutputs().filter((o) => !o.success);
  }

  // Tool results
  recordToolResult(result: ToolResult): void {
    this.toolResults.push(result);
  }

  getToolResults(): ToolResult[] {
    return [...this.toolResults];
  }

  getRecentToolResults(count: number = 10): ToolResult[] {
    return this.toolResults.slice(-count);
  }

  // Execution logs
  log(level: ExecutionLog['level'], message: string, agent?: string): void {
    this.executionLogs.push({
      level,
      message,
      timestamp: new Date(),
      agent,
    });
  }

  info(message: string, agent?: string): void {
    this.log('info', message, agent);
  }

  warn(message: string, agent?: string): void {
    this.log('warn', message, agent);
  }

  error(message: string, agent?: string): void {
    this.log('error', message, agent);
  }

  getExecutionLogs(): ExecutionLog[] {
    return [...this.executionLogs];
  }

  getRecentLogs(count: number = 20): ExecutionLog[] {
    return this.executionLogs.slice(-count);
  }

  // Summary
  getSummary(): {
    totalAgents: number;
    successfulAgents: number;
    failedAgents: number;
    toolsUsed: number;
    errors: number;
    warnings: number;
  } {
    const outputs = this.getAllAgentOutputs();
    const logs = this.getExecutionLogs();

    return {
      totalAgents: outputs.length,
      successfulAgents: outputs.filter((o) => o.success).length,
      failedAgents: outputs.filter((o) => !o.success).length,
      toolsUsed: this.toolResults.length,
      errors: logs.filter((l) => l.level === 'error').length,
      warnings: logs.filter((l) => l.level === 'warn').length,
    };
  }

  // Clear (for testing)
  clear(): void {
    this.taskContext = {};
    this.agentOutputs.clear();
    this.toolResults = [];
    this.executionLogs = [];
  }
}
