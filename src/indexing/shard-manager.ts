import type { ShardMetadata, ShardConfig, IndexShard } from './types.js';
import { readFile, writeFile, readdir, mkdir, rm } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';

/**
 * ShardManager - Manages sharded repository indexing for large codebases
 *
 * Partitions repositories into shards of 20k-50k files each
 * Enables dynamic loading and efficient querying
 */
export class ShardManager {
  private shards: Map<string, ShardMetadata> = new Map();
  private fileToShard: Map<string, string> = new Map(); // file -> shard ID
  private config: ShardConfig;
  private indexDir: string;

  constructor(
    indexDir: string,
    config: Partial<ShardConfig> = {},
  ) {
    this.indexDir = indexDir;
    this.config = {
      maxFilesPerShard: config.maxFilesPerShard || 30000,
      maxShardSize: config.maxShardSize || 1024 * 1024 * 1024, // 1GB
      shardingStrategy: config.shardingStrategy || 'directory',
    };
  }

  /**
   * Initialize shard manager
   */
  async initialize(): Promise<void> {
    const shardDir = join(this.indexDir, 'shards');

    if (!existsSync(shardDir)) {
      await mkdir(shardDir, { recursive: true });
      return;
    }

    // Load existing shards
    await this.loadShards();
  }

  /**
   * Create shards for a list of files
   */
  async createShards(files: string[]): Promise<ShardMetadata[]> {
    const shards = this.partitionFiles(files);
    const createdShards: ShardMetadata[] = [];

    for (const [shardId, shardFiles] of shards) {
      const metadata: ShardMetadata = {
        id: shardId,
        fileCount: shardFiles.length,
        totalSize: 0, // Will be calculated during indexing
        files: shardFiles,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.shards.set(shardId, metadata);

      // Update file-to-shard mapping
      for (const file of shardFiles) {
        this.fileToShard.set(file, shardId);
      }

      await this.saveShard(metadata);
      createdShards.push(metadata);
    }

    await this.saveManifest();

    return createdShards;
  }

  /**
   * Partition files into shards using configured strategy
   */
  private partitionFiles(files: string[]): Map<string, string[]> {
    const shards = new Map<string, string[]>();

    switch (this.config.shardingStrategy) {
      case 'directory':
        return this.partitionByDirectory(files);

      case 'hash':
        return this.partitionByHash(files);

      case 'size':
        return this.partitionBySize(files);

      default:
        return this.partitionByDirectory(files);
    }
  }

  /**
   * Partition by top-level directory
   */
  private partitionByDirectory(files: string[]): Map<string, string[]> {
    const byDir = new Map<string, string[]>();

    for (const file of files) {
      const parts = file.split('/');
      const topDir = parts[0] || 'root';

      const dirFiles = byDir.get(topDir) || [];
      dirFiles.push(file);
      byDir.set(topDir, dirFiles);
    }

    // Consolidate into shards
    const shards = new Map<string, string[]>();
    let currentShard: string[] = [];
    let shardIndex = 0;

    for (const [dir, dirFiles] of byDir) {
      // If directory is too large, split it
      if (dirFiles.length > this.config.maxFilesPerShard) {
        // Split large directory
        const chunks = this.chunkArray(dirFiles, this.config.maxFilesPerShard);
        for (let i = 0; i < chunks.length; i++) {
          const shardId = `shard-${shardIndex++}`;
          shards.set(shardId, chunks[i]);
        }
      } else {
        // Add to current shard
        currentShard.push(...dirFiles);

        // If current shard exceeds limit, create new shard
        if (currentShard.length >= this.config.maxFilesPerShard) {
          const shardId = `shard-${shardIndex++}`;
          shards.set(shardId, currentShard);
          currentShard = [];
        }
      }
    }

    // Add remaining files
    if (currentShard.length > 0) {
      const shardId = `shard-${shardIndex++}`;
      shards.set(shardId, currentShard);
    }

    return shards;
  }

  /**
   * Partition by file path hash
   */
  private partitionByHash(files: string[]): Map<string, string[]> {
    const numShards = Math.ceil(files.length / this.config.maxFilesPerShard);
    const shards = new Map<string, string[]>();

    // Initialize shards
    for (let i = 0; i < numShards; i++) {
      shards.set(`shard-${i}`, []);
    }

    // Distribute files by hash
    for (const file of files) {
      const hash = createHash('md5').update(file).digest('hex');
      const shardIndex = parseInt(hash.substring(0, 8), 16) % numShards;
      const shardId = `shard-${shardIndex}`;

      shards.get(shardId)!.push(file);
    }

    return shards;
  }

  /**
   * Partition by file size to balance shard sizes
   */
  private partitionBySize(files: string[]): Map<string, string[]> {
    // For now, fall back to directory-based partitioning
    // In production, would calculate actual file sizes
    return this.partitionByDirectory(files);
  }

  /**
   * Get shard for a file
   */
  getShardForFile(filePath: string): ShardMetadata | null {
    const shardId = this.fileToShard.get(filePath);
    if (!shardId) return null;

    return this.shards.get(shardId) || null;
  }

  /**
   * Get all shards
   */
  getAllShards(): ShardMetadata[] {
    return Array.from(this.shards.values());
  }

  /**
   * Get shard by ID
   */
  getShard(shardId: string): ShardMetadata | undefined {
    return this.shards.get(shardId);
  }

  /**
   * Load shard data (lazy loading)
   */
  async loadShardData(shardId: string): Promise<IndexShard | null> {
    const metadata = this.shards.get(shardId);
    if (!metadata) return null;

    const shardDir = join(this.indexDir, 'shards', shardId);

    // Load symbol index
    const symbolsFile = join(shardDir, 'symbols.json');
    let symbolIndex = null;

    if (existsSync(symbolsFile)) {
      const content = await readFile(symbolsFile, 'utf-8');
      symbolIndex = JSON.parse(content);
    }

    // Load vector index
    const vectorsFile = join(shardDir, 'vectors.json');
    let vectorIndex = null;

    if (existsSync(vectorsFile)) {
      const content = await readFile(vectorsFile, 'utf-8');
      vectorIndex = JSON.parse(content);
    }

    return {
      metadata,
      symbolIndex,
      vectorIndex,
    };
  }

  /**
   * Update shard metadata
   */
  async updateShard(shardId: string, updates: Partial<ShardMetadata>): Promise<void> {
    const metadata = this.shards.get(shardId);
    if (!metadata) throw new Error(`Shard not found: ${shardId}`);

    Object.assign(metadata, updates);
    metadata.updatedAt = new Date().toISOString();

    await this.saveShard(metadata);
  }

  /**
   * Save shard metadata
   */
  private async saveShard(metadata: ShardMetadata): Promise<void> {
    const shardDir = join(this.indexDir, 'shards', metadata.id);

    if (!existsSync(shardDir)) {
      await mkdir(shardDir, { recursive: true });
    }

    const metadataFile = join(shardDir, 'metadata.json');
    await writeFile(metadataFile, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  /**
   * Load all shards
   */
  private async loadShards(): Promise<void> {
    const shardDir = join(this.indexDir, 'shards');
    const shardDirs = await readdir(shardDir);

    for (const dir of shardDirs) {
      const metadataFile = join(shardDir, dir, 'metadata.json');

      if (existsSync(metadataFile)) {
        const content = await readFile(metadataFile, 'utf-8');
        const metadata: ShardMetadata = JSON.parse(content);

        this.shards.set(metadata.id, metadata);

        // Rebuild file-to-shard mapping
        for (const file of metadata.files) {
          this.fileToShard.set(file, metadata.id);
        }
      }
    }
  }

  /**
   * Save manifest of all shards
   */
  private async saveManifest(): Promise<void> {
    const manifestFile = join(this.indexDir, 'shard-manifest.json');

    const manifest = {
      shardCount: this.shards.size,
      totalFiles: this.fileToShard.size,
      shards: Array.from(this.shards.values()).map((s) => ({
        id: s.id,
        fileCount: s.fileCount,
        totalSize: s.totalSize,
      })),
      updatedAt: new Date().toISOString(),
    };

    await writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  /**
   * Delete shard
   */
  async deleteShard(shardId: string): Promise<void> {
    const metadata = this.shards.get(shardId);
    if (!metadata) return;

    // Remove file mappings
    for (const file of metadata.files) {
      this.fileToShard.delete(file);
    }

    // Remove from memory
    this.shards.delete(shardId);

    // Remove from disk
    const shardDir = join(this.indexDir, 'shards', shardId);
    if (existsSync(shardDir)) {
      await rm(shardDir, { recursive: true });
    }

    await this.saveManifest();
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    shardCount: number;
    totalFiles: number;
    avgFilesPerShard: number;
    largestShard: number;
    smallestShard: number;
  } {
    const fileCounts = Array.from(this.shards.values()).map((s) => s.fileCount);

    return {
      shardCount: this.shards.size,
      totalFiles: this.fileToShard.size,
      avgFilesPerShard: this.fileToShard.size / Math.max(1, this.shards.size),
      largestShard: Math.max(...fileCounts, 0),
      smallestShard: Math.min(...fileCounts, 0),
    };
  }

  /**
   * Helper: chunk array
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
