/**
 * ExecutionStateStore — persists ExecutionGraph state to disk.
 *
 * Enables:
 *   - Agent resume after process crash or restart
 *   - Long-running multi-hour session continuity
 *   - Post-mortem debugging of failed graphs
 *   - Audit trail of all graph executions
 *
 * Storage: .koda/execution-state/<graphId>.json
 *
 * Format:
 * ```json
 * {
 *   "graphId": "graph-1234-abc",
 *   "task": "Implement JWT authentication",
 *   "savedAt": 1720000000000,
 *   "status": "running",
 *   "graph": { ... ExecutionGraph.toJSON() ... }
 * }
 * ```
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import type { GraphJSON } from '../execution/execution-graph.js';
import { logger } from '../utils/logger.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const STATE_DIR       = '.koda/execution-state';
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'paused' | 'aborted';

export interface PersistedExecutionState {
  /** Graph identifier matching ExecutionGraph.graphId. */
  graphId: string;
  /** Human-readable task description. */
  task: string;
  /** Unix ms when this record was written. */
  savedAt: number;
  /** Current lifecycle status of the graph. */
  status: ExecutionStatus;
  /** Full serialized graph including all node states and results. */
  graph: GraphJSON;
  /** How many completed nodes are in this snapshot. */
  completedNodeCount: number;
  /** How many failed nodes are in this snapshot. */
  failedNodeCount: number;
}

// ── ExecutionStateStore ───────────────────────────────────────────────────────

export class ExecutionStateStore {
  constructor(private readonly rootPath: string) {}

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Save current graph state to disk.
   *
   * Non-fatal: logs a warning on write failure instead of throwing.
   *
   * @param graph  - The ExecutionGraph to persist.
   * @param status - Current status label.
   */
  async save(
    graph: { graphId: string; task: string; toJSON(): GraphJSON; getStats(): { completed: number; failed: number } },
    status: ExecutionStatus = 'running',
  ): Promise<void> {
    try {
      const dir = path.join(this.rootPath, STATE_DIR);
      await fs.mkdir(dir, { recursive: true });

      const stats = graph.getStats();
      const state: PersistedExecutionState = {
        graphId:            graph.graphId,
        task:               graph.task,
        savedAt:            Date.now(),
        status,
        graph:              graph.toJSON(),
        completedNodeCount: stats.completed,
        failedNodeCount:    stats.failed,
      };

      await fs.writeFile(
        path.join(dir, `${graph.graphId}.json`),
        JSON.stringify(state, null, 2),
        'utf-8',
      );

      logger.debug(
        `[execution-state] Saved "${graph.graphId}" ` +
        `(status=${status}, completed=${stats.completed}, failed=${stats.failed})`,
      );
    } catch (err) {
      logger.warn(`[execution-state] Save failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Load a persisted graph state by graphId.
   *
   * Returns null when the state file does not exist or is corrupted.
   */
  async load(graphId: string): Promise<PersistedExecutionState | null> {
    try {
      const filePath = path.join(this.rootPath, STATE_DIR, `${graphId}.json`);
      const raw      = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as PersistedExecutionState;
    } catch {
      return null;
    }
  }

  /**
   * List all persisted execution states, sorted newest-first.
   *
   * Skips corrupted files silently.
   */
  async list(): Promise<PersistedExecutionState[]> {
    try {
      const dir   = path.join(this.rootPath, STATE_DIR);
      const files = await fs.readdir(dir);
      const states: PersistedExecutionState[] = [];

      await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            try {
              const raw = await fs.readFile(path.join(dir, f), 'utf-8');
              states.push(JSON.parse(raw) as PersistedExecutionState);
            } catch {
              // skip corrupted files
            }
          }),
      );

      return states.sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  }

  /**
   * Find the most recent resumable graph (status = 'running' or 'paused').
   *
   * Returns null when nothing is resumable.
   */
  async findResumable(): Promise<PersistedExecutionState | null> {
    const states = await this.list();
    return states.find((s) => s.status === 'running' || s.status === 'paused') ?? null;
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  /** Delete the state file for a specific graphId. Non-fatal. */
  async delete(graphId: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.rootPath, STATE_DIR, `${graphId}.json`));
      logger.debug(`[execution-state] Deleted state for "${graphId}"`);
    } catch {
      // already deleted or never existed
    }
  }

  /**
   * Delete all states older than `maxAgeMs` milliseconds.
   *
   * @returns Number of deleted files.
   */
  async pruneOld(maxAgeMs = DEFAULT_MAX_AGE): Promise<number> {
    const states  = await this.list();
    const cutoff  = Date.now() - maxAgeMs;
    let   deleted = 0;

    for (const s of states) {
      if (s.savedAt < cutoff) {
        await this.delete(s.graphId);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.debug(`[execution-state] Pruned ${deleted} state file(s) older than ${Math.round(maxAgeMs / 86400000)}d`);
    }

    return deleted;
  }

  /** Mark a graph as completed (convenience wrapper around save). */
  async markCompleted(
    graph: { graphId: string; task: string; toJSON(): GraphJSON; getStats(): { completed: number; failed: number } },
  ): Promise<void> {
    await this.save(graph, 'completed');
  }

  /** Mark a graph as failed. */
  async markFailed(
    graph: { graphId: string; task: string; toJSON(): GraphJSON; getStats(): { completed: number; failed: number } },
  ): Promise<void> {
    await this.save(graph, 'failed');
  }
}
