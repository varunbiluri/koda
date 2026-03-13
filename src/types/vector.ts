export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface VectorEntry {
  chunkId: string;
  vector: SparseVector;
}

export interface SearchResult {
  chunkId: string;
  score: number;
}
