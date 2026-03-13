/**
 * Indexing types for large-scale repository handling
 */

export interface ShardMetadata {
  id: string;
  fileCount: number;
  totalSize: number;
  files: string[]; // File paths in this shard
  createdAt: string;
  updatedAt: string;
}

export interface ShardConfig {
  maxFilesPerShard: number; // Target: 20k-50k files
  maxShardSize: number; // Max size in bytes (e.g., 1GB)
  shardingStrategy: 'directory' | 'hash' | 'size';
}

export interface IndexShard {
  metadata: ShardMetadata;
  symbolIndex: any; // SymbolIndex
  vectorIndex: any; // VectorShard
}

export interface IncrementalUpdate {
  changedFiles: string[];
  deletedFiles: string[];
  affectedShards: string[];
  timestamp: string;
}
