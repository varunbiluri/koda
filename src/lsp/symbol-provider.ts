import type { SymbolIndex } from '../symbols/symbol-index.js';
import type { SymbolRecord, SymbolSearchResult } from '../symbols/types.js';

export interface Location {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface HoverInfo {
  symbol: SymbolRecord;
  definedIn: string;
  callers: SymbolRecord[];
  aiExplanation?: string;
}

/**
 * SymbolProvider - Bridges SymbolIndex with LSP protocol needs.
 */
export class SymbolProvider {
  constructor(private symbolIndex: SymbolIndex) {}

  findReferences(symbolName: string): { definition: Location | null; callers: Location[]; files: string[] } {
    const symbols = this.symbolIndex.findByName(symbolName);
    if (symbols.length === 0) {
      return { definition: null, callers: [], files: [] };
    }

    const primary = symbols[0];
    const definition = symbolToLocation(primary);
    const callerRecords = this.symbolIndex.getCallers(primary.id);
    const callers = callerRecords.map(symbolToLocation);
    const files = Array.from(new Set([primary.location.filePath, ...callerRecords.map(c => c.location.filePath)]));

    return { definition, callers, files };
  }

  findDefinition(symbolName: string, _currentFile?: string): Location | null {
    const symbols = this.symbolIndex.findByName(symbolName);
    if (symbols.length === 0) return null;
    return symbolToLocation(symbols[0]);
  }

  workspaceSymbols(query: string): SymbolSearchResult[] {
    return this.symbolIndex.search(query, 50);
  }

  getHoverInfo(symbolName: string): HoverInfo | null {
    const symbols = this.symbolIndex.findByName(symbolName);
    if (symbols.length === 0) return null;

    const symbol = symbols[0];
    const callers = this.symbolIndex.getCallers(symbol.id);

    return {
      symbol,
      definedIn: symbol.location.filePath,
      callers,
    };
  }
}

function symbolToLocation(symbol: SymbolRecord): Location {
  return {
    uri: `file://${symbol.location.filePath}`,
    range: {
      start: { line: symbol.location.line - 1, character: symbol.location.column },
      end: { line: symbol.location.endLine - 1, character: symbol.location.endColumn },
    },
  };
}
