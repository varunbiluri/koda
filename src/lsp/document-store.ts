import type { SymbolIndex } from '../symbols/symbol-index.js';

export interface TextDocumentContentChangeEvent {
  text: string;
}

export interface StoredDocument {
  uri: string;
  text: string;
}

/**
 * DocumentStore - Tracks open text documents keyed by URI.
 * Provides text content for hover/position queries.
 */
export class DocumentStore {
  private documents: Map<string, StoredDocument> = new Map();

  constructor(private symbolIndex: SymbolIndex) {}

  open(uri: string, text: string): void {
    this.documents.set(uri, { uri, text });
  }

  update(uri: string, changes: TextDocumentContentChangeEvent[]): void {
    const doc = this.documents.get(uri);
    if (!doc) return;
    const text = changes[changes.length - 1]?.text ?? doc.text;
    this.documents.set(uri, { uri, text });
  }

  close(uri: string): void {
    this.documents.delete(uri);
  }

  get(uri: string): StoredDocument | undefined {
    return this.documents.get(uri);
  }

  getSymbolIndex(): SymbolIndex {
    return this.symbolIndex;
  }
}
