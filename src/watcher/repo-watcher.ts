import { EventEmitter } from 'events';
import { RepoWatcher as BaseRepoWatcher } from '../indexing/repo-watcher.js';
import { IncrementalIndexer } from '../indexing/incremental-indexer.js';
import { ShardManager } from '../indexing/shard-manager.js';
import { EventDispatcher, type FileEvent } from './event-dispatcher.js';
import { statSync } from 'fs';
import { join } from 'path';

/**
 * WatcherService - Wraps the base RepoWatcher with event-based dispatch.
 * Emits: file-changed, file-created, file-deleted events.
 */
export class WatcherService extends EventEmitter {
  private baseWatcher: BaseRepoWatcher;
  private dispatcher: EventDispatcher;

  constructor(
    private rootPath: string,
    dispatcher?: EventDispatcher,
  ) {
    super();
    const shardManager = new ShardManager(join(rootPath, '.koda', 'shards'));
    const indexer = new IncrementalIndexer(rootPath, shardManager);
    this.baseWatcher = new BaseRepoWatcher(rootPath, indexer);
    this.dispatcher = dispatcher ?? new EventDispatcher();
  }

  getDispatcher(): EventDispatcher {
    return this.dispatcher;
  }

  start(): void {
    this.baseWatcher.start(async (changedFiles: string[]) => {
      for (const file of changedFiles) {
        const absPath = join(this.rootPath, file);
        const eventType = detectEventType(absPath);
        const event: FileEvent = {
          type: eventType,
          filePath: absPath,
          timestamp: Date.now(),
        };
        this.dispatcher.dispatch(event);
        this.emit(eventType, event);
        console.log(`[watcher] ${eventType}: ${file}`);
      }
    });
  }

  stop(): void {
    this.baseWatcher.stop();
  }
}

function detectEventType(filePath: string): FileEvent['type'] {
  try {
    statSync(filePath);
    return 'file-changed';
  } catch {
    return 'file-deleted';
  }
}
