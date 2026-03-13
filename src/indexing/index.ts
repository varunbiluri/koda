// Scalable indexing module

export { ShardManager } from './shard-manager.js';
export { IncrementalIndexer } from './incremental-indexer.js';
export { RepoWatcher } from './repo-watcher.js';
export { WorkerPool } from './worker-pool.js';

export type {
  ShardMetadata,
  ShardConfig,
  IndexShard,
  IncrementalUpdate,
} from './types.js';
