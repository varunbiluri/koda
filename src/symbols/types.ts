/**
 * Symbol intelligence types for large-scale repository analysis
 */

export type SymbolType =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'import'
  | 'export';

export interface SymbolLocation {
  filePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface SymbolReference {
  symbolName: string;
  location: SymbolLocation;
  kind: 'definition' | 'usage' | 'import' | 'export';
}

export interface SymbolRecord {
  id: string; // Unique identifier: file#name
  name: string;
  qualifiedName: string; // Full path: Module.Class.method
  type: SymbolType;
  location: SymbolLocation;
  signature?: string; // Function/method signature
  docstring?: string; // Documentation comment
  modifiers: string[]; // public, private, static, async, etc.
  parent?: string; // Parent symbol ID for nested symbols
  references: string[]; // Symbol names referenced by this symbol
  callers: Set<string>; // Symbol IDs that call/use this symbol
  metadata: {
    complexity?: number;
    exported: boolean;
    imported: boolean;
    deprecated?: boolean;
  };
}

export interface SymbolExtractionResult {
  symbols: SymbolRecord[];
  imports: Map<string, string[]>; // Module -> imported symbols
  exports: Map<string, string[]>; // Module -> exported symbols
  errors: string[];
}

export interface SymbolQueryOptions {
  type?: SymbolType;
  name?: string;
  file?: string;
  includeReferences?: boolean;
  includeCallers?: boolean;
  maxDepth?: number;
}

export interface SymbolSearchResult {
  symbol: SymbolRecord;
  score: number;
  matchReason: string;
}
