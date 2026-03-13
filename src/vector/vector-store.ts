import type { VectorEntry, VectorSearchResult } from './types.js';
import { VectorShard } from './vector-shard.js';
import { join } from 'path';

/**
 * VectorStore - Manages multiple vector shards
 */
export class VectorStore {
  private shards: Map<string, VectorShard> = new Map();

  constructor(private indexDir: string) {}

  /**
   * Add or get shard
   */
  getOrCreateShard(shardId: string): VectorShard {
    if (!this.shards.has(shardId)) {
      this.shards.set(shardId, new VectorShard(shardId));
    }

    return this.shards.get(shardId)!;
  }

  /**
   * Search across all shards
   */
  async search(queryVector: number[], topK: number = 10): Promise<VectorSearchResult[]> {
    const allResults: VectorSearchResult[] = [];

    for (const shard of this.shards.values()) {
      const shardResults = shard.search(queryVector, topK);
      allResults.push(...shardResults);
    }

    // Sort and return top K
    allResults.sort((a, b) => b.score - a.score);

    return allResults.slice(0, topK);
  }

  /**
   * Search specific shards
   */
  async searchShards(
    shardIds: string[],
    queryVector: number[],
    topK: number = 10,
  ): Promise<VectorSearchResult[]> {
    const allResults: VectorSearchResult[] = [];

    for (const shardId of shardIds) {
      const shard = this.shards.get(shardId);
      if (shard) {
        const shardResults = shard.search(queryVector, topK);
        allResults.push(...shardResults);
      }
    }

    allResults.sort((a, b) => b.score - a.score);

    return allResults.slice(0, topK);
  }

  /**
   * Save all shards
   */
  async saveAll(): Promise<void> {
    for (const [shardId, shard] of this.shards) {
      const filePath = join(this.indexDir, 'shards', shardId, 'vectors.json');
      await shard.save(filePath);
    }
  }

  /**
   * Load shard
   */
  async loadShard(shardId: string): Promise<void> {
    const filePath = join(this.indexDir, 'shards', shardId, 'vectors.json');
    const shard = new VectorShard(shardId);

    await shard.load(filePath);
    this.shards.set(shardId, shard);
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    shardCount: number;
    totalVectors: number;
  } {
    let totalVectors = 0;

    for (const shard of this.shards.values()) {
      totalVectors += shard.size();
    }

    return {
      shardCount: this.shards.size,
      totalVectors,
    };
  }
}
