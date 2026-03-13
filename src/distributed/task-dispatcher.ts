import type { WorkerTask, TaskResult } from './types.js';
import { EventEmitter } from 'events';

/**
 * TaskDispatcher - Distributes tasks to worker nodes
 */
export class TaskDispatcher extends EventEmitter {
  private taskQueue: WorkerTask[] = [];
  private pendingTasks: Map<string, WorkerTask> = new Map();
  private completedTasks: Map<string, TaskResult> = new Map();

  constructor() {
    super();
  }

  /**
   * Enqueue task
   */
  enqueue(task: WorkerTask): void {
    this.taskQueue.push(task);

    // Sort by priority (higher first)
    this.taskQueue.sort((a, b) => b.priority - a.priority);

    this.emit('task-queued', task);
  }

  /**
   * Get next task
   */
  dequeue(): WorkerTask | null {
    const task = this.taskQueue.shift();

    if (task) {
      this.pendingTasks.set(task.id, task);
      this.emit('task-dispatched', task);
    }

    return task || null;
  }

  /**
   * Mark task as complete
   */
  complete(result: TaskResult): void {
    this.pendingTasks.delete(result.taskId);
    this.completedTasks.set(result.taskId, result);

    this.emit('task-completed', result);
  }

  /**
   * Mark task as failed and re-queue
   */
  retry(taskId: string): void {
    const task = this.pendingTasks.get(taskId);

    if (task) {
      this.pendingTasks.delete(taskId);
      this.taskQueue.unshift(task); // Add to front
      this.emit('task-retried', task);
    }
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    queued: number;
    pending: number;
    completed: number;
  } {
    return {
      queued: this.taskQueue.length,
      pending: this.pendingTasks.size,
      completed: this.completedTasks.size,
    };
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(): void {
    this.completedTasks.clear();
  }
}
