export interface DependencyEdge {
  source: string;     // File path (importer)
  target: string;     // File path (imported)
  symbols: string[];  // Imported symbol names
}

export interface DependencyNode {
  filePath: string;
  inDegree: number;   // Number of files that import this one
  outDegree: number;  // Number of files this one imports
}
