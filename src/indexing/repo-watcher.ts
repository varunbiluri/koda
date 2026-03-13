import type { IncrementalIndexer } from './incremental-indexer.js';
import { watch, FSWatcher } from 'fs';
import { join } from 'path';

export type WatcherCallback = (changedFiles: string[]) => Promise<void>;

/**
 * RepoWatcher - Monitors repository for changes and triggers incremental indexing
 */
export class RepoWatcher {
  private watcher?: FSWatcher;
  private debounceTimer?: NodeJS.Timeout;
  private pendingChanges: Set<string> = new Set();

  constructor(
    private rootPath: string,
    private incrementalIndexer: IncrementalIndexer,
    private debounceMs: number = 2000,
  ) {}

  /**
   * Start watching repository
   */
  start(callback: WatcherCallback): void {
    this.watcher = watch(
      this.rootPath,
      { recursive: true },
      (eventType, filename) => {
        if (!filename) return;

        // Skip .koda directory
        if (filename.startsWith('.koda')) return;

        // Skip node_modules
        if (filename.includes('node_modules')) return;

        // Skip hidden files
        if (filename.startsWith('.')) return;

        this.pendingChanges.add(filename);

        // Debounce changes
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(async () => {
          const changes = Array.from(this.pendingChanges);
          this.pendingChanges.clear();

          await callback(changes);
        }, this.debounceMs);
      },
    );
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }
}
