import { EventEmitter } from 'events';

export interface ScheduledTask {
  id: string;
  fileKey: string;
  agentType: string;
  filePath: string;
  priority: number;
  createdAt: number;
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

/**
 * BackgroundTaskScheduler - Priority queue with deduplication and concurrency limiting.
 */
export class BackgroundTaskScheduler extends EventEmitter {
  private queue: ScheduledTask[] = [];
  private running = 0;
  private seen = new Set<string>();

  constructor(private concurrencyLimit: number = 2) {
    super();
  }

  enqueue(task: Omit<ScheduledTask, 'id' | 'fileKey' | 'createdAt'>): boolean {
    const fileKey = `${task.agentType}:${task.filePath}`;
    if (this.seen.has(fileKey)) return false;

    this.seen.add(fileKey);
    const scheduled: ScheduledTask = {
      id: `${fileKey}-${Date.now()}`,
      fileKey,
      createdAt: Date.now(),
      ...task,
    };

    this.queue.push(scheduled);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.drain();
    return true;
  }

  private drain(): void {
    while (this.running < this.concurrencyLimit && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      this.running++;
      this.emit('task-started', task);

      // Tasks are executed externally — scheduler just manages the queue.
      // Callers must call taskCompleted/taskFailed.
    }
  }

  taskCompleted(taskId: string): void {
    this.running = Math.max(0, this.running - 1);
    this.emit('task-completed', taskId);
    this.drain();
  }

  taskFailed(taskId: string, error: string): void {
    this.running = Math.max(0, this.running - 1);
    this.emit('task-failed', { taskId, error });
    this.drain();
  }

  clearSeen(fileKey: string): void {
    this.seen.delete(fileKey);
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get activeCount(): number {
    return this.running;
  }
}
