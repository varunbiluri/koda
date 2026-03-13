import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { join } from 'path';

export interface WorkerTask {
  id: string;
  type: 'parse' | 'chunk' | 'embed';
  data: unknown;
}

export interface WorkerResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * WorkerPool - Manages worker threads for parallel processing
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private taskQueue: WorkerTask[] = [];
  private activeTs: Map<string, WorkerTask> = new Map();
  private results: Map<string, WorkerResult> = new Map();

  constructor(
    private workerScript: string,
    private poolSize: number = cpus().length,
  ) {}

  /**
   * Initialize worker pool
   */
  async initialize(): Promise<void> {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(this.workerScript);

      worker.on('message', (result: WorkerResult) => {
        this.handleWorkerResult(result);
      });

      worker.on('error', (error) => {
        console.error(`Worker error:`, error);
      });

      this.workers.push(worker);
    }
  }

  /**
   * Submit task to pool
   */
  async submitTask(task: WorkerTask): Promise<WorkerResult> {
    return new Promise((resolve) => {
      this.taskQueue.push(task);

      // Set up result listener
      const checkResult = () => {
        const result = this.results.get(task.id);
        if (result) {
          this.results.delete(task.id);
          resolve(result);
        } else {
          setTimeout(checkResult, 100);
        }
      };

      checkResult();
      this.processQueue();
    });
  }

  /**
   * Process task queue
   */
  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const freeWorker = this.workers.find((w) => !this.isWorkerBusy(w));

      if (!freeWorker) break;

      const task = this.taskQueue.shift()!;
      this.activeTs.set(task.id, task);

      freeWorker.postMessage(task);
    }
  }

  /**
   * Check if worker is busy
   */
  private isWorkerBusy(worker: Worker): boolean {
    // Simple check - in production, track per-worker state
    return this.activeTs.size >= this.poolSize;
  }

  /**
   * Handle worker result
   */
  private handleWorkerResult(result: WorkerResult): void {
    this.results.set(result.taskId, result);
    this.activeTs.delete(result.taskId);

    // Process more tasks
    this.processQueue();
  }

  /**
   * Terminate all workers
   */
  async terminate(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    poolSize: number;
    queuedTasks: number;
    activeTasks: number;
  } {
    return {
      poolSize: this.workers.length,
      queuedTasks: this.taskQueue.length,
      activeTasks: this.activeTs.size,
    };
  }
}
