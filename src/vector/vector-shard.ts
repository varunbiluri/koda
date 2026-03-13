import type { VectorEntry, VectorShardMetadata, VectorSearchResult } from './types.js';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * VectorShard - Stores vectors for a shard of files
 */
export class VectorShard {
  private vectors: Map<string, VectorEntry> = new Map();
  private metadata: VectorShardMetadata;

  constructor(shardId: string, dimension: number = 768) {
    this.metadata = {
      id: shardId,
      vectorCount: 0,
      dimension,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Add vector to shard
   */
  add(entry: VectorEntry): void {
    this.vectors.set(entry.id, entry);
    this.metadata.vectorCount = this.vectors.size;
    this.metadata.updatedAt = new Date().toISOString();
  }

  /**
   * Add multiple vectors
   */
  addAll(entries: VectorEntry[]): void {
    for (const entry of entries) {
      this.add(entry);
    }
  }

  /**
   * Search vectors using cosine similarity
   */
  search(queryVector: number[], topK: number = 10): VectorSearchResult[] {
    const results: VectorSearchResult[] = [];

    for (const [id, entry] of this.vectors) {
      const score = this.cosineSimilarity(queryVector, entry.vector);

      results.push({
        id,
        score,
        metadata: entry.metadata,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  /**
   * Calculate cosine similarity
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Save shard to disk
   */
  async save(filePath: string): Promise<void> {
    const data = {
      metadata: this.metadata,
      vectors: Array.from(this.vectors.entries()).map(([, entry]) => entry),
    };

    await writeFile(filePath, JSON.stringify(data), 'utf-8');
  }

  /**
   * Load shard from disk
   */
  async load(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      throw new Error(`Vector shard file not found: ${filePath}`);
    }

    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    this.metadata = data.metadata;
    this.vectors.clear();

    for (const entry of data.vectors) {
      this.vectors.set(entry.id, entry);
    }
  }

  /**
   * Get size
   */
  size(): number {
    return this.vectors.size;
  }

  /**
   * Get metadata
   */
  getMetadata(): VectorShardMetadata {
    return { ...this.metadata };
  }
}
