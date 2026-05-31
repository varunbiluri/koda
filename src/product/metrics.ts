/**
 * ProductMetrics — tracks task-level outcomes and context-efficiency telemetry.
 *
 * Persisted to `.koda/metrics.json` (v2).
 *
 * Tracks:
 *   - task success rate, retries, duration
 *   - prompt/completion tokens, tool calls, refRate (context efficiency)
 *   - route, diffAccepted, contextPeakChars
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';
import { computeKei, median } from './task-telemetry.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type TaskKind = 'fix' | 'add' | 'refactor' | 'auto' | 'ask' | 'review' | 'chat' | 'other';

export type TaskRoute = 'simple' | 'medium' | 'complex' | 'cli' | 'unknown';

export interface TaskTelemetry {
  provider:            string;
  model:               string;
  promptTokens:        number;
  completionTokens:    number;
  toolCalls:           number;
  refRate:             number;
  toolResultsTotal:    number;
  toolResultsViaRef:   number;
  route?:              TaskRoute | string;
  diffAccepted?:       boolean;
  contextPeakChars?:   number;
}

export interface TaskRecord {
  id:                  string;
  kind:                TaskKind;
  description:         string;
  startedAt:             number;
  completedAt:           number;
  durationMs:            number;
  success:               boolean;
  retries:               number;
  provider?:             string;
  model?:                string;
  promptTokens?:         number;
  completionTokens?:     number;
  toolCalls?:            number;
  refRate?:              number;
  toolResultsTotal?:     number;
  toolResultsViaRef?:    number;
  route?:                string;
  diffAccepted?:         boolean;
  contextPeakChars?:     number;
}

export interface MetricsStore {
  version:               number;
  firstSeenAt:             number;
  lastSeenAt:              number;
  sessionCount:            number;
  totalTasks:              number;
  successCount:            number;
  failureCount:            number;
  totalRetries:            number;
  totalTimeMs:             number;
  totalPromptTokens:       number;
  totalCompletionTokens:   number;
  /** Baseline median tokens for KEI (set by KCB-10 or manual config). */
  keiBaselineMedianTokens?: number;
  recentTasks:             TaskRecord[];
  daysActive:              string[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const METRICS_VERSION = 2;
const METRICS_FILE    = path.join('.koda', 'metrics.json');
const MAX_RECENT      = 100;

/** Session-based agent baseline for KEI (tokens per successful task). */
export const DEFAULT_KEI_BASELINE_TOKENS = 52_000;

// ── ProductMetrics ─────────────────────────────────────────────────────────────

export class ProductMetrics {
  private store:     MetricsStore;
  private cacheFile: string;
  private dirty       = false;
  private activeTask:  Partial<TaskRecord> | null = null;

  private constructor(cacheFile: string, store: MetricsStore) {
    this.cacheFile = cacheFile;
    this.store     = store;
  }

  static async load(rootPath: string): Promise<ProductMetrics> {
    const cacheFile = path.join(rootPath, METRICS_FILE);
    try {
      const raw   = await fs.readFile(cacheFile, 'utf8');
      const store = JSON.parse(raw) as MetricsStore;
      if (store.version !== METRICS_VERSION) {
        return new ProductMetrics(cacheFile, migrateStore(store));
      }
      const m = new ProductMetrics(cacheFile, store);
      m._recordSession();
      return m;
    } catch {
      return new ProductMetrics(cacheFile, fresh());
    }
  }

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

  taskComplete(opts: {
    success:     boolean;
    retries:     number;
    durationMs?: number;
    telemetry?:  TaskTelemetry;
  }): void {
    if (!this.activeTask) return;

    const completedAt = Date.now();
    const t             = opts.telemetry;

    const record: TaskRecord = {
      id:               this.activeTask.id!,
      kind:             this.activeTask.kind as TaskKind,
      description:      this.activeTask.description!,
      startedAt:        this.activeTask.startedAt!,
      completedAt,
      durationMs:       opts.durationMs ?? (completedAt - (this.activeTask.startedAt ?? completedAt)),
      success:          opts.success,
      retries:          opts.retries,
      provider:         t?.provider,
      model:            t?.model,
      promptTokens:     t?.promptTokens,
      completionTokens: t?.completionTokens,
      toolCalls:        t?.toolCalls,
      refRate:          t?.refRate,
      toolResultsTotal: t?.toolResultsTotal,
      toolResultsViaRef: t?.toolResultsViaRef,
      route:            t?.route,
      diffAccepted:     t?.diffAccepted,
      contextPeakChars: t?.contextPeakChars,
    };

    this.store.totalTasks++;
    this.store.totalTimeMs += record.durationMs;
    this.store.totalRetries += record.retries;
    if (t?.promptTokens)     this.store.totalPromptTokens += t.promptTokens;
    if (t?.completionTokens) this.store.totalCompletionTokens += t.completionTokens;
    if (record.success) this.store.successCount++;
    else                this.store.failureCount++;
    this.store.lastSeenAt = completedAt;

    this.store.recentTasks.unshift(record);
    if (this.store.recentTasks.length > MAX_RECENT) {
      this.store.recentTasks = this.store.recentTasks.slice(0, MAX_RECENT);
    }

    this.activeTask = null;
    this.dirty = true;
  }

  setKeiBaseline(medianTokens: number): void {
    this.store.keiBaselineMedianTokens = medianTokens;
    this.dirty = true;
  }

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

  medianPromptTokens(): number {
    const vals = this.store.recentTasks
      .map((t) => t.promptTokens ?? 0)
      .filter((n) => n > 0);
    return median(vals);
  }

  medianTotalTokens(): number {
    const vals = this.store.recentTasks
      .map((t) => (t.promptTokens ?? 0) + (t.completionTokens ?? 0))
      .filter((n) => n > 0);
    return median(vals);
  }

  medianRefRate(): number {
    const vals = this.store.recentTasks
      .map((t) => t.refRate ?? 0)
      .filter((t) => t > 0);
    return vals.length > 0 ? median(vals) : 0;
  }

  /** KEI from stored baseline vs recent median total tokens. Returns 0 if no baseline. */
  computeKei(): number {
    const baseline = this.store.keiBaselineMedianTokens;
    if (!baseline) return 0;
    const totals = this.store.recentTasks
      .map((t) => (t.promptTokens ?? 0) + (t.completionTokens ?? 0))
      .filter((n) => n > 0);
    const agentMedian = median(totals);
    return computeKei(baseline, agentMedian);
  }

  estimatedHoursSaved(): number {
    return (this.store.successCount * 20) / 60;
  }

  getStore(): Readonly<MetricsStore> {
    return this.store;
  }

  formatSummary(): string {
    const s = this.store;
    if (s.totalTasks === 0) return '';

    const pct   = Math.round(this.successRate() * 100);
    const avgMs = Math.round(this.avgDurationMs() / 1000);
    const hours = this.estimatedHoursSaved().toFixed(1);
    const kei   = this.computeKei();
    const ref   = Math.round(this.medianRefRate() * 100);

    const lines = [
      `  Tasks:        ${s.totalTasks} total (${pct}% success)`,
      `  Avg retries:  ${this.avgRetries().toFixed(1)} per task`,
      `  Avg duration: ${avgMs}s per task`,
      `  Time saved:   ~${hours}h of dev work`,
      `  Sessions:     ${s.sessionCount} (${s.daysActive.length} active days)`,
    ];

    if (s.totalPromptTokens > 0) {
      lines.push(`  Tokens:       ${(s.totalPromptTokens + s.totalCompletionTokens).toLocaleString()} total`);
    }
    if (ref > 0) {
      lines.push(`  Ref rate:     ${ref}% tool output via references`);
    }
    if (kei > 0) {
      lines.push(`  KEI:          ${kei}/100`);
    }

    return lines.join('\n');
  }

  formatOneLiner(): string {
    if (this.store.totalTasks === 0) return '';
    const pct   = Math.round(this.successRate() * 100);
    const hours = this.estimatedHoursSaved().toFixed(1);
    const kei   = this.computeKei();
    const keiStr = kei > 0 ? ` · KEI ${kei}` : '';
    return `${this.store.successCount}/${this.store.totalTasks} tasks (${pct}%) · ~${hours}h saved${keiStr}`;
  }

  /** Full efficiency dashboard for /cost and benchmarks. */
  formatEfficiencyReport(sessionTokens?: number, sessionRefRate?: number): string {
    const kei = this.computeKei();
    const ref = Math.round((sessionRefRate ?? this.medianRefRate()) * 100);
    const lines = [
      '  Efficiency Report',
      '  ─────────────────',
      `  KEI:              ${kei > 0 ? `${kei}/100` : 'set baseline via KCB-10'}`,
      `  Ref rate:         ${ref}% tool output via references`,
      `  Median tokens:    ${this.medianTotalTokens().toLocaleString()} (recent tasks)`,
      `  Success rate:     ${Math.round(this.successRate() * 100)}%`,
      `  Tasks recorded:   ${this.store.totalTasks}`,
    ];
    if (sessionTokens !== undefined && sessionTokens > 0) {
      lines.push(`  Session tokens:   ${sessionTokens.toLocaleString()}`);
    }
    return lines.join('\n');
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(this.store, null, 2), 'utf8');
      this.dirty = false;
    } catch (err) {
      logger.warn(`[product-metrics] Flush failed: ${(err as Error).message}`);
    }
  }

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

function fresh(): MetricsStore {
  const now = Date.now();
  return {
    version:             METRICS_VERSION,
    firstSeenAt:         now,
    lastSeenAt:          now,
    sessionCount:        1,
    totalTasks:          0,
    successCount:        0,
    failureCount:        0,
    totalRetries:        0,
    totalTimeMs:         0,
    totalPromptTokens:   0,
    totalCompletionTokens: 0,
    recentTasks:         [],
    daysActive:          [new Date().toISOString().slice(0, 10)],
  };
}

function migrateStore(old: MetricsStore): MetricsStore {
  return {
    ...old,
    version:               METRICS_VERSION,
    totalPromptTokens:     0,
    totalCompletionTokens: 0,
    recentTasks:           old.recentTasks ?? [],
  };
}

export { computeKei };
