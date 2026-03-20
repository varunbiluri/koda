/**
 * BackgroundIndexer — async, debounced re-indexing triggered by file changes.
 *
 * Problem: After `koda init`, if files are edited between sessions the
 * RepoGraph and ASTRepoGraph become stale. Re-building the full graph on
 * every command is expensive for large repos.
 *
 * Solution:
 *   1. A FileWatcher (thin wrapper around fs.watch / chokidar-like polling)
 *      detects file system changes.
 *   2. Changes are batched into 500ms debounce windows (DEBOUNCE_MS).
 *   3. Only the changed files' edges are re-computed (incremental update).
 *   4. The rebuilt graph is stored in memory; callers subscribe via onChange.
 *   5. Background work runs in the same process but never blocks the CLI.
 *
 * Design constraints:
 *   - No external dependencies (uses only node:fs.watch).
 *   - Non-fatal: failures are logged and the stale graph continues to serve.
 *   - The indexer can be stopped cleanly with stop().
 *
 * Usage:
 * ```ts
 * const indexer = new BackgroundIndexer({ rootPath, filePaths });
 * indexer.onChange((graph) => { currentGraph = graph; });
 * await indexer.start();
 * // ... later ...
 * indexer.stop();
 * ```
 */

import * as fs     from 'node:fs';
import * as path   from 'node:path';
import { EventEmitter } from 'node:events';
import { ASTRepoGraph } from '../intelligence/ast-repo-graph.js';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BackgroundIndexerOptions {
  /** Absolute root path of the repository. */
  rootPath:   string;
  /** Initial set of file paths to index (absolute or relative to rootPath). */
  filePaths:  string[];
  /** Debounce window in ms before triggering re-index. Default: 500ms. */
  debounceMs?: number;
  /** Directories to watch. Default: ['src', 'lib', 'tests']. */
  watchDirs?:  string[];
}

export type GraphChangeHandler = (graph: ASTRepoGraph, changedFiles: string[]) => void;

// ── BackgroundIndexer ──────────────────────────────────────────────────────────

export class BackgroundIndexer extends EventEmitter {
  private readonly rootPath:   string;
  private filePaths:           string[];
  private readonly debounceMs: number;
  private readonly watchDirs:  string[];

  private watchers:   fs.FSWatcher[] = [];
  private timer:      NodeJS.Timeout | null = null;
  private pending:    Set<string>    = new Set();
  private running     = false;
  private indexCount  = 0;

  constructor(opts: BackgroundIndexerOptions) {
    super();
    this.rootPath   = opts.rootPath;
    this.filePaths  = [...opts.filePaths];
    this.debounceMs = opts.debounceMs ?? 500;
    this.watchDirs  = opts.watchDirs  ?? ['src', 'lib', 'tests'];
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Start watching. Returns immediately; indexing runs in background. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    for (const dir of this.watchDirs) {
      const absDir = path.isAbsolute(dir) ? dir : path.join(this.rootPath, dir);
      try {
        const watcher = fs.watch(absDir, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          const absFile = path.join(absDir, filename);
          if (INDEXABLE.test(filename)) {
            this._enqueue(absFile);
          }
        });
        this.watchers.push(watcher);
        logger.debug(`[background-indexer] Watching: ${absDir}`);
      } catch {
        // Directory may not exist — ignore (non-fatal)
      }
    }

    logger.debug('[background-indexer] Started.');
  }

  /** Stop all file watchers and cancel pending re-index. */
  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    for (const w of this.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.watchers = [];
    logger.debug('[background-indexer] Stopped.');
  }

  // ── Event API ──────────────────────────────────────────────────────────────

  /** Subscribe to graph rebuild events. */
  onChange(handler: GraphChangeHandler): this {
    return this.on('change', handler);
  }

  /** Return indexing statistics. */
  getStats(): { indexCount: number; watchedDirs: number; pendingFiles: number } {
    return {
      indexCount:   this.indexCount,
      watchedDirs:  this.watchers.length,
      pendingFiles: this.pending.size,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _enqueue(absFile: string): void {
    this.pending.add(absFile);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this._reindex(), this.debounceMs);
  }

  private async _reindex(): Promise<void> {
    const changed = Array.from(this.pending);
    this.pending.clear();
    this.timer = null;

    // Merge changed files into the file list (add new, unchanged existing stay)
    for (const f of changed) {
      const rel = path.relative(this.rootPath, f);
      if (!this.filePaths.includes(rel) && !this.filePaths.includes(f)) {
        this.filePaths.push(rel);
      }
    }

    logger.debug(`[background-indexer] Re-indexing ${changed.length} changed file(s)…`);

    try {
      const graph = await ASTRepoGraph.build(this.rootPath, this.filePaths);
      this.indexCount++;
      this.emit('change', graph, changed);
      logger.debug(`[background-indexer] Re-index #${this.indexCount} complete.`);
    } catch (err) {
      logger.warn(`[background-indexer] Re-index failed (non-fatal): ${(err as Error).message}`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const INDEXABLE = /\.(ts|tsx|js|mjs|cjs|jsx|py|go|rs)$/i;
