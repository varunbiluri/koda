import type { WorkerNode, WorkerTask, TaskResult } from './types.js';
import { TaskDispatcher } from './task-dispatcher.js';
import { EventEmitter } from 'events';

/**
 * WorkerManager - Manages distributed worker nodes
 */
export class WorkerManager extends EventEmitter {
  private workers: Map<string, WorkerNode> = new Map();
  private dispatcher: TaskDispatcher;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor() {
    super();
    this.dispatcher = new TaskDispatcher();

    // Listen for task events
    this.dispatcher.on('task-queued', () => this.assignTasks());
  }

  /**
   * Register worker node
   */
  registerWorker(workerId: string): void {
    const worker: WorkerNode = {
      id: workerId,
      status: 'idle',
      tasksCompleted: 0,
      lastHeartbeat: new Date().toISOString(),
    };

    this.workers.set(workerId, worker);
    this.emit('worker-registered', worker);

    // Try to assign a task immediately
    this.assignTasks();
  }

  /**
   * Unregister worker
   */
  unregisterWorker(workerId: string): void {
    const worker = this.workers.get(workerId);

    if (worker) {
      // Re-queue current task if any
      if (worker.currentTask) {
        this.dispatcher.retry(worker.currentTask);
      }

      this.workers.delete(workerId);
      this.emit('worker-unregistered', worker);
    }
  }

  /**
   * Submit task to dispatcher
   */
  submitTask(task: WorkerTask): void {
    this.dispatcher.enqueue(task);
  }

  /**
   * Assign tasks to idle workers
   */
  private assignTasks(): void {
    const idleWorkers = Array.from(this.workers.values()).filter((w) => w.status === 'idle');

    for (const worker of idleWorkers) {
      const task = this.dispatcher.dequeue();

      if (!task) break;

      worker.status = 'busy';
      worker.currentTask = task.id;

      this.emit('task-assigned', { worker, task });
    }
  }

  /**
   * Report task completion
   */
  reportCompletion(result: TaskResult): void {
    const worker = this.workers.get(result.workerId);

    if (worker) {
      worker.status = 'idle';
      worker.currentTask = undefined;
      worker.tasksCompleted++;
      worker.lastHeartbeat = new Date().toISOString();
    }

    this.dispatcher.complete(result);

    // Assign more tasks
    this.assignTasks();
  }

  /**
   * Report worker heartbeat
   */
  heartbeat(workerId: string): void {
    const worker = this.workers.get(workerId);

    if (worker) {
      worker.lastHeartbeat = new Date().toISOString();
    }
  }

  /**
   * Start heartbeat monitoring
   */
  startHeartbeatMonitoring(timeoutMs: number = 30000): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      for (const [id, worker] of this.workers) {
        const lastBeat = new Date(worker.lastHeartbeat).getTime();

        if (now - lastBeat > timeoutMs) {
          worker.status = 'offline';
          this.emit('worker-timeout', worker);

          // Re-queue task if worker was busy
          if (worker.currentTask) {
            this.dispatcher.retry(worker.currentTask);
            worker.currentTask = undefined;
          }
        }
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop heartbeat monitoring
   */
  stopHeartbeatMonitoring(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalWorkers: number;
    idleWorkers: number;
    busyWorkers: number;
    offlineWorkers: number;
    queuedTasks: number;
    completedTasks: number;
  } {
    const workers = Array.from(this.workers.values());
    const dispatcherStats = this.dispatcher.getStatistics();

    return {
      totalWorkers: workers.length,
      idleWorkers: workers.filter((w) => w.status === 'idle').length,
      busyWorkers: workers.filter((w) => w.status === 'busy').length,
      offlineWorkers: workers.filter((w) => w.status === 'offline').length,
      queuedTasks: dispatcherStats.queued,
      completedTasks: dispatcherStats.completed,
    };
  }

  /**
   * Get all workers
   */
  getWorkers(): WorkerNode[] {
    return Array.from(this.workers.values());
  }
}
