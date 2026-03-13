import type { DependencyEdge, DependencyNode, FileInfo } from '../../types/index.js';
import type { ImportInfo } from '../ast/extractors/base-extractor.js';
import { resolveImportPath, buildFileIndex } from './resolver.js';

export interface FileImports {
  filePath: string;
  imports: ImportInfo[];
}

export interface DependencyGraph {
  edges: DependencyEdge[];
  nodes: DependencyNode[];
}

export function buildDependencyGraph(
  fileImports: FileImports[],
  files: FileInfo[],
): DependencyGraph {
  const fileIndex = buildFileIndex(files);
  const edges: DependencyEdge[] = [];
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  // Initialize all files with 0
  for (const file of files) {
    inDegree.set(file.path, 0);
    outDegree.set(file.path, 0);
  }

  for (const { filePath, imports } of fileImports) {
    for (const imp of imports) {
      const resolved = resolveImportPath(imp.source, filePath, fileIndex);
      if (!resolved) continue;

      edges.push({
        source: filePath,
        target: resolved,
        symbols: imp.symbols,
      });

      inDegree.set(resolved, (inDegree.get(resolved) ?? 0) + 1);
      outDegree.set(filePath, (outDegree.get(filePath) ?? 0) + 1);
    }
  }

  const nodes: DependencyNode[] = files.map(f => ({
    filePath: f.path,
    inDegree: inDegree.get(f.path) ?? 0,
    outDegree: outDegree.get(f.path) ?? 0,
  }));

  return { edges, nodes };
}
