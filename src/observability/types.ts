export type EventType =
  | 'agent_started'
  | 'agent_finished'
  | 'tool_called'
  | 'file_modified'
  | 'verification_started'
  | 'verification_passed'
  | 'verification_failed'
  | 'iteration_started'
  | 'iteration_completed'
  | 'budget_exceeded'
  | 'lock_acquired'
  | 'lock_released';

export interface ExecutionEvent {
  type: EventType;
  timestamp: Date;
  agentName?: string;
  toolName?: string;
  filePath?: string;
  details?: Record<string, unknown>;
}

export interface ExecutionMetrics {
  totalAgents: number;
  successfulAgents: number;
  failedAgents: number;
  iterations: number;
  filesModified: number;
  testsRun: number;
  totalDuration: number;
  tokenUsage: number;
}
