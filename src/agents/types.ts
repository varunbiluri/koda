import type { WorkspaceMemory } from '../memory/workspace-memory.js';

export interface AgentInput {
  task: string;
  context?: Record<string, unknown>;
  dependencies?: AgentOutput[];
}

export interface AgentOutput {
  agentName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  filesModified?: string[];
  toolsUsed?: string[];
  suggestions?: string[];
  nextSteps?: string[];
}

export interface Agent {
  name: string;
  category: AgentCategory;
  description: string;
  execute(input: AgentInput, memory: WorkspaceMemory): Promise<AgentOutput>;
}

export type AgentCategory =
  | 'planning'
  | 'coding'
  | 'testing'
  | 'debugging'
  | 'review'
  | 'optimization'
  | 'infrastructure';

export interface Task {
  id: string;
  description: string;
  type: string;
  priority: number;
  dependencies: string[];
  assignedAgent?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  output?: AgentOutput;
}

export interface ExecutionPlan {
  tasks: Task[];
  waves: Task[][];
  estimatedDuration?: number;
}
