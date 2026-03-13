/**
 * Scalable vector storage types
 */

export interface VectorEntry {
  id: string; // Chunk or symbol ID
  vector: number[];
  metadata: {
    filePath: string;
    chunkType?: string;
    symbolName?: string;
  };
}

export interface VectorShardMetadata {
  id: string;
  vectorCount: number;
  dimension: number;
  createdAt: string;
  updatedAt: string;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: VectorEntry['metadata'];
}
