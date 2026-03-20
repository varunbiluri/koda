/**
 * ProductMetrics — tracks task-level outcomes for product health and user value.
 *
 * Persisted to `.koda/metrics.json`.
 *
 * Tracks (Part 7):
 *   - task success rate    — did Koda complete what was asked?
 *   - retries per task     — how many fix loops were needed?
 *   - time saved           — wall-clock of each task (dev time proxy)
 *   - user retention       — session count, days active, tasks per session
 *
 * Usage:
 * ```ts
 * const m = await ProductMetrics.load(rootPath);
 * m.taskStart('fix', 'null pointer in auth');
 * // ... run task ...
 * m.taskComplete({ success: true, retries: 1, durationMs: 12_000 });
 * await m.flush();
 * console.log(m.formatSummary());
 * ```
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type TaskKind = 'fix' | 'add' | 'refactor' | 'auto' | 'ask' | 'review' | 'other';

export interface TaskRecord {
  id:          string;
  kind:        TaskKind;
  description: string;
  startedAt:   number;
  completedAt: number;
  durationMs:  number;
  success:     boolean;
  retries:     number;
}

export interface MetricsStore {
  version:       number;
  firstSeenAt:   number;
  lastSeenAt:    number;
  sessionCount:  number;
  totalTasks:    number;
  successCount:  number;
  failureCount:  number;
  totalRetries:  number;
  totalTimeMs:   number;
  recentTasks:   TaskRecord[];    // last 100
  daysActive:    string[];        // ISO date strings (deduped)
}

// ── Constants ──────────────────────────────────────────────────────────────────

const METRICS_VERSION = 1;
const METRICS_FILE    = path.join('.koda', 'metrics.json');
const MAX_RECENT      = 100;

// ── ProductMetrics ─────────────────────────────────────────────────────────────

export class ProductMetrics {
  private store:   MetricsStore;
  private cacheFile: string;
  private dirty  = false;
  private activeTask: Partial<TaskRecord> | null = null;

  private constructor(cacheFile: string, store: MetricsStore) {
    this.cacheFile = cacheFile;
    this.store     = store;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static async load(rootPath: string): Promise<ProductMetrics> {
    const cacheFile = path.join(rootPath, METRICS_FILE);
    try {
      const raw   = await fs.readFile(cacheFile, 'utf8');
      const store = JSON.parse(raw) as MetricsStore;
      if (store.version !== METRICS_VERSION) {
        return new ProductMetrics(cacheFile, fresh());
      }
      const m = new ProductMetrics(cacheFile, store);
      m._recordSession();
      return m;
    } catch {
      return new ProductMetrics(cacheFile, fresh());
    }
  }

  // ── Task tracking ──────────────────────────────────────────────────────────

  /** Call at the start of any task execution. */
  taskStart(kind: TaskKind, description: string): string {
    const id = `task_${Date.now()}`;
    this.activeTask = {
      id,
      kind,
      description: description.slice(0, 200),
      startedAt:   Date.now(),
    };
    return id;
  }

  /** Call when the task completes (success or failure). */
  taskComplete(opts: { success: boolean; retries: number; durationMs?: number }): void {
    if (!this.activeTask) return;

    const completedAt = Date.now();
    const record: TaskRecord = {
      id:          this.activeTask.id!,
      kind:        this.activeTask.kind as TaskKind,
      description: this.activeTask.description!,
      startedAt:   this.activeTask.startedAt!,
      completedAt,
      durationMs:  opts.durationMs ?? (completedAt - (this.activeTask.startedAt ?? completedAt)),
      success:     opts.success,
      retries:     opts.retries,
    };

    this.store.totalTasks++;
    this.store.totalTimeMs += record.durationMs;
    this.store.totalRetries += record.retries;
    if (record.success) this.store.successCount++;
    else                this.store.failureCount++;
    this.store.lastSeenAt = completedAt;

    // Keep last N tasks
    this.store.recentTasks.unshift(record);
    if (this.store.recentTasks.length > MAX_RECENT) {
      this.store.recentTasks = this.store.recentTasks.slice(0, MAX_RECENT);
    }

    this.activeTask = null;
    this.dirty = true;
  }

  // ── Aggregates ─────────────────────────────────────────────────────────────

  successRate(): number {
    if (this.store.totalTasks === 0) return 0;
    return this.store.successCount / this.store.totalTasks;
  }

  avgRetries(): number {
    if (this.store.totalTasks === 0) return 0;
    return this.store.totalRetries / this.store.totalTasks;
  }

  avgDurationMs(): number {
    if (this.store.totalTasks === 0) return 0;
    return this.store.totalTimeMs / this.store.totalTasks;
  }

  /** Estimated developer-hours saved (1 task = 20min saved on average). */
  estimatedHoursSaved(): number {
    return (this.store.successCount * 20) / 60;
  }

  getStore(): Readonly<MetricsStore> {
    return this.store;
  }

  // ── Display ────────────────────────────────────────────────────────────────

  formatSummary(): string {
    const s = this.store;
    if (s.totalTasks === 0) return '';

    const pct      = Math.round(this.successRate() * 100);
    const avgMs    = Math.round(this.avgDurationMs() / 1000);
    const hours    = this.estimatedHoursSaved().toFixed(1);
    const sessions = s.sessionCount;

    return [
      `  Tasks:        ${s.totalTasks} total (${pct}% success)`,
      `  Avg retries:  ${this.avgRetries().toFixed(1)} per task`,
      `  Avg duration: ${avgMs}s per task`,
      `  Time saved:   ~${hours}h of dev work`,
      `  Sessions:     ${sessions} (${s.daysActive.length} active days)`,
    ].join('\n');
  }

  formatOneLiner(): string {
    if (this.store.totalTasks === 0) return '';
    const pct   = Math.round(this.successRate() * 100);
    const hours = this.estimatedHoursSaved().toFixed(1);
    return `${this.store.successCount}/${this.store.totalTasks} tasks completed (${pct}%) · ~${hours}h saved`;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(this.store), 'utf8');
      this.dirty = false;
    } catch (err) {
      logger.warn(`[product-metrics] Flush failed: ${(err as Error).message}`);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _recordSession(): void {
    this.store.sessionCount++;
    this.store.lastSeenAt = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    if (!this.store.daysActive.includes(today)) {
      this.store.daysActive.push(today);
    }
    this.dirty = true;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fresh(): MetricsStore {
  const now = Date.now();
  return {
    version:      METRICS_VERSION,
    firstSeenAt:  now,
    lastSeenAt:   now,
    sessionCount: 1,
    totalTasks:   0,
    successCount: 0,
    failureCount: 0,
    totalRetries: 0,
    totalTimeMs:  0,
    recentTasks:  [],
    daysActive:   [new Date().toISOString().slice(0, 10)],
  };
}
