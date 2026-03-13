/**
 * Distributed execution types
 */

export interface WorkerTask {
  id: string;
  type: 'agent' | 'index' | 'search';
  payload: unknown;
  priority: number;
}

export interface WorkerNode {
  id: string;
  status: 'idle' | 'busy' | 'offline';
  currentTask?: string;
  tasksCompleted: number;
  lastHeartbeat: string;
}

export interface TaskResult {
  taskId: string;
  workerId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}
