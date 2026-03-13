import type { FileInfo } from './file-info.js';
import type { CodeChunk } from './code-chunk.js';
import type { DependencyEdge, DependencyNode } from './dependency.js';
import type { VectorEntry } from './vector.js';

export interface IndexMetadata {
  version: string;
  createdAt: string;
  rootPath: string;
  fileCount: number;
  chunkCount: number;
  edgeCount: number;
}

export interface Vocabulary {
  terms: string[];
  termToIndex: Record<string, number>;
}

export interface RepoIndex {
  metadata: IndexMetadata;
  files: FileInfo[];
  chunks: CodeChunk[];
  edges: DependencyEdge[];
  nodes: DependencyNode[];
  vectors: VectorEntry[];
  vocabulary: Vocabulary;
}
