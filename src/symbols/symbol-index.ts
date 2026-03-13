import type { SymbolRecord, SymbolType, SymbolQueryOptions, SymbolSearchResult } from './types.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * SymbolIndex - Fast symbol lookup and query engine
 *
 * Provides O(1) lookup by name and efficient queries by type, file, etc.
 */
export class SymbolIndex {
  private symbols: Map<string, SymbolRecord> = new Map(); // id -> symbol
  private byName: Map<string, SymbolRecord[]> = new Map(); // name -> symbols
  private byType: Map<SymbolType, SymbolRecord[]> = new Map(); // type -> symbols
  private byFile: Map<string, SymbolRecord[]> = new Map(); // file -> symbols

  private indexPath?: string;

  constructor(indexPath?: string) {
    this.indexPath = indexPath;
  }

  /**
   * Add symbol to index
   */
  add(symbol: SymbolRecord): void {
    this.symbols.set(symbol.id, symbol);

    // Index by name
    const byNameList = this.byName.get(symbol.name) || [];
    byNameList.push(symbol);
    this.byName.set(symbol.name, byNameList);

    // Index by type
    const byTypeList = this.byType.get(symbol.type) || [];
    byTypeList.push(symbol);
    this.byType.set(symbol.type, byTypeList);

    // Index by file
    const byFileList = this.byFile.get(symbol.location.filePath) || [];
    byFileList.push(symbol);
    this.byFile.set(symbol.location.filePath, byFileList);
  }

  /**
   * Add multiple symbols
   */
  addAll(symbols: SymbolRecord[]): void {
    for (const symbol of symbols) {
      this.add(symbol);
    }
  }

  /**
   * Get symbol by ID
   */
  get(id: string): SymbolRecord | undefined {
    return this.symbols.get(id);
  }

  /**
   * Find symbols by name
   */
  findByName(name: string): SymbolRecord[] {
    return this.byName.get(name) || [];
  }

  /**
   * Find symbols by type
   */
  findByType(type: SymbolType): SymbolRecord[] {
    return this.byType.get(type) || [];
  }

  /**
   * Find symbols in a file
   */
  findByFile(filePath: string): SymbolRecord[] {
    return this.byFile.get(filePath) || [];
  }

  /**
   * Query symbols with advanced options
   */
  query(options: SymbolQueryOptions): SymbolRecord[] {
    let results: SymbolRecord[] = Array.from(this.symbols.values());

    // Filter by name
    if (options.name) {
      results = results.filter((s) =>
        s.name.toLowerCase().includes(options.name!.toLowerCase()),
      );
    }

    // Filter by type
    if (options.type) {
      results = results.filter((s) => s.type === options.type);
    }

    // Filter by file
    if (options.file) {
      results = results.filter((s) => s.location.filePath === options.file);
    }

    return results;
  }

  /**
   * Search symbols with fuzzy matching
   */
  search(query: string, limit: number = 10): SymbolSearchResult[] {
    const queryLower = query.toLowerCase();
    const results: SymbolSearchResult[] = [];

    for (const symbol of this.symbols.values()) {
      let score = 0;
      let reason = '';

      // Exact match
      if (symbol.name.toLowerCase() === queryLower) {
        score = 100;
        reason = 'exact match';
      }
      // Starts with
      else if (symbol.name.toLowerCase().startsWith(queryLower)) {
        score = 80;
        reason = 'starts with query';
      }
      // Contains
      else if (symbol.name.toLowerCase().includes(queryLower)) {
        score = 50;
        reason = 'contains query';
      }
      // Qualified name match
      else if (symbol.qualifiedName.toLowerCase().includes(queryLower)) {
        score = 40;
        reason = 'matches qualified name';
      }

      if (score > 0) {
        results.push({
          symbol,
          score,
          matchReason: reason,
        });
      }
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Get all callers of a symbol
   */
  getCallers(symbolId: string): SymbolRecord[] {
    const symbol = this.symbols.get(symbolId);
    if (!symbol) return [];

    const callers: SymbolRecord[] = [];
    for (const callerId of symbol.callers) {
      const caller = this.symbols.get(callerId);
      if (caller) callers.push(caller);
    }

    return callers;
  }

  /**
   * Get all references made by a symbol
   */
  getReferences(symbolId: string): SymbolRecord[] {
    const symbol = this.symbols.get(symbolId);
    if (!symbol) return [];

    const references: SymbolRecord[] = [];

    for (const refName of symbol.references) {
      const refs = this.findByName(refName);
      references.push(...refs);
    }

    return references;
  }

  /**
   * Get call graph for a symbol (recursive)
   */
  getCallGraph(symbolId: string, maxDepth: number = 3): Map<string, SymbolRecord> {
    const graph = new Map<string, SymbolRecord>();
    const visited = new Set<string>();

    const traverse = (id: string, depth: number) => {
      if (depth > maxDepth || visited.has(id)) return;

      visited.add(id);
      const symbol = this.symbols.get(id);
      if (!symbol) return;

      graph.set(id, symbol);

      // Traverse references
      for (const refName of symbol.references) {
        const refs = this.findByName(refName);
        for (const ref of refs) {
          traverse(ref.id, depth + 1);
        }
      }
    };

    traverse(symbolId, 0);

    return graph;
  }

  /**
   * Get reverse call graph (who calls this symbol)
   */
  getReverseCallGraph(symbolId: string, maxDepth: number = 3): Map<string, SymbolRecord> {
    const graph = new Map<string, SymbolRecord>();
    const visited = new Set<string>();

    const traverse = (id: string, depth: number) => {
      if (depth > maxDepth || visited.has(id)) return;

      visited.add(id);
      const symbol = this.symbols.get(id);
      if (!symbol) return;

      graph.set(id, symbol);

      // Traverse callers
      for (const callerId of symbol.callers) {
        traverse(callerId, depth + 1);
      }
    };

    traverse(symbolId, 0);

    return graph;
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalSymbols: number;
    byType: Record<SymbolType, number>;
    byFile: number;
    exported: number;
    imported: number;
  } {
    const byType: Partial<Record<SymbolType, number>> = {};
    let exported = 0;
    let imported = 0;

    for (const symbol of this.symbols.values()) {
      byType[symbol.type] = (byType[symbol.type] || 0) + 1;

      if (symbol.metadata.exported) exported++;
      if (symbol.metadata.imported) imported++;
    }

    return {
      totalSymbols: this.symbols.size,
      byType: byType as Record<SymbolType, number>,
      byFile: this.byFile.size,
      exported,
      imported,
    };
  }

  /**
   * Save index to disk
   */
  async save(): Promise<void> {
    if (!this.indexPath) {
      throw new Error('Index path not set');
    }

    const indexDir = this.indexPath;
    if (!existsSync(indexDir)) {
      await mkdir(indexDir, { recursive: true });
    }

    // Convert symbols Map to serializable format
    const symbolsArray = Array.from(this.symbols.values()).map((s) => ({
      ...s,
      callers: Array.from(s.callers),
    }));

    const data = {
      symbols: symbolsArray,
      metadata: {
        symbolCount: this.symbols.size,
        updatedAt: new Date().toISOString(),
      },
    };

    const filePath = join(indexDir, 'symbols.json');
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Load index from disk
   */
  async load(): Promise<void> {
    if (!this.indexPath) {
      throw new Error('Index path not set');
    }

    const filePath = join(this.indexPath, 'symbols.json');

    if (!existsSync(filePath)) {
      throw new Error('Symbol index file not found');
    }

    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Clear existing data
    this.symbols.clear();
    this.byName.clear();
    this.byType.clear();
    this.byFile.clear();

    // Restore symbols
    for (const symbolData of data.symbols) {
      const symbol: SymbolRecord = {
        ...symbolData,
        callers: new Set(symbolData.callers),
      };

      this.add(symbol);
    }
  }

  /**
   * Clear index
   */
  clear(): void {
    this.symbols.clear();
    this.byName.clear();
    this.byType.clear();
    this.byFile.clear();
  }

  /**
   * Get size
   */
  size(): number {
    return this.symbols.size;
  }
}
