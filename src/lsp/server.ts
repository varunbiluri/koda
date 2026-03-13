import { ConnectionManager, type LspMessage } from './connection-manager.js';
import { DocumentStore } from './document-store.js';
import { SymbolProvider } from './symbol-provider.js';
import { HoverProvider } from './hover-provider.js';
import { CodeActionProvider } from './code-action-provider.js';
import { SymbolIndex } from '../symbols/symbol-index.js';
import { join } from 'path';

const KODA_DIR = '.koda';

/**
 * LspServer - Implements the Language Server Protocol over stdio.
 * Handles: initialize, textDocument/hover, textDocument/definition,
 * textDocument/references, workspace/symbol, textDocument/codeAction,
 * shutdown, exit.
 */
export class LspServer {
  private connection: ConnectionManager;
  private documentStore: DocumentStore;
  private symbolProvider: SymbolProvider;
  private hoverProvider: HoverProvider;
  private codeActionProvider: CodeActionProvider;
  private shutdown = false;

  constructor(rootPath: string = process.cwd()) {
    const symbolIndex = new SymbolIndex(join(rootPath, KODA_DIR, 'symbols'));
    this.documentStore = new DocumentStore(symbolIndex);
    this.symbolProvider = new SymbolProvider(symbolIndex);
    this.hoverProvider = new HoverProvider(this.documentStore, this.symbolProvider);
    this.codeActionProvider = new CodeActionProvider();
    this.connection = new ConnectionManager(process.stdin, process.stdout);
    this.connection.on('message', (msg: LspMessage) => this.handleMessage(msg));
  }

  async start(): Promise<void> {
    // Try loading persisted symbol index
    try {
      await this.documentStore.getSymbolIndex().load();
    } catch {
      // No index yet — server still works
    }

    return new Promise((resolve) => {
      this.connection.on('close', resolve);
    });
  }

  private handleMessage(msg: LspMessage): void {
    if (!msg.method) return;

    switch (msg.method) {
      case 'initialize':
        this.onInitialize(msg);
        break;
      case 'initialized':
        break;
      case 'textDocument/didOpen':
        this.onDidOpen(msg);
        break;
      case 'textDocument/didChange':
        this.onDidChange(msg);
        break;
      case 'textDocument/didClose':
        this.onDidClose(msg);
        break;
      case 'textDocument/hover':
        this.onHover(msg);
        break;
      case 'textDocument/definition':
        this.onDefinition(msg);
        break;
      case 'textDocument/references':
        this.onReferences(msg);
        break;
      case 'workspace/symbol':
        this.onWorkspaceSymbol(msg);
        break;
      case 'textDocument/codeAction':
        this.onCodeAction(msg);
        break;
      case 'shutdown':
        this.shutdown = true;
        this.connection.sendResponse(msg.id ?? null, null);
        break;
      case 'exit':
        process.exit(this.shutdown ? 0 : 1);
        break;
      default:
        if (msg.id !== undefined) {
          this.connection.sendError(msg.id ?? null, -32601, `Method not found: ${msg.method}`);
        }
    }
  }

  private onInitialize(msg: LspMessage): void {
    this.connection.sendResponse(msg.id ?? null, {
      capabilities: {
        textDocumentSync: 1,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        workspaceSymbolProvider: true,
        codeActionProvider: true,
      },
      serverInfo: { name: 'koda-lsp', version: '1.0.0' },
    });
  }

  private onDidOpen(msg: LspMessage): void {
    const params = msg.params as { textDocument: { uri: string; text: string } };
    this.documentStore.open(params.textDocument.uri, params.textDocument.text);
  }

  private onDidChange(msg: LspMessage): void {
    const params = msg.params as {
      textDocument: { uri: string };
      contentChanges: Array<{ text: string }>;
    };
    this.documentStore.update(params.textDocument.uri, params.contentChanges);
  }

  private onDidClose(msg: LspMessage): void {
    const params = msg.params as { textDocument: { uri: string } };
    this.documentStore.close(params.textDocument.uri);
  }

  private onHover(msg: LspMessage): void {
    const params = msg.params as { textDocument: { uri: string }; position: { line: number; character: number } };
    const result = this.hoverProvider.getHover(params.textDocument.uri, params.position);
    this.connection.sendResponse(msg.id ?? null, result);
  }

  private onDefinition(msg: LspMessage): void {
    const params = msg.params as { textDocument: { uri: string }; position: { line: number; character: number } };
    const doc = this.documentStore.get(params.textDocument.uri);
    if (!doc) {
      this.connection.sendResponse(msg.id ?? null, null);
      return;
    }
    const lines = doc.text.split('\n');
    const line = lines[params.position.line] ?? '';
    const word = extractWordAt(line, params.position.character);
    const location = word ? this.symbolProvider.findDefinition(word, params.textDocument.uri) : null;
    this.connection.sendResponse(msg.id ?? null, location);
  }

  private onReferences(msg: LspMessage): void {
    const params = msg.params as { textDocument: { uri: string }; position: { line: number; character: number } };
    const doc = this.documentStore.get(params.textDocument.uri);
    if (!doc) {
      this.connection.sendResponse(msg.id ?? null, []);
      return;
    }
    const lines = doc.text.split('\n');
    const line = lines[params.position.line] ?? '';
    const word = extractWordAt(line, params.position.character);
    if (!word) {
      this.connection.sendResponse(msg.id ?? null, []);
      return;
    }
    const refs = this.symbolProvider.findReferences(word);
    this.connection.sendResponse(msg.id ?? null, [refs.definition, ...refs.callers].filter(Boolean));
  }

  private onWorkspaceSymbol(msg: LspMessage): void {
    const params = msg.params as { query: string };
    const results = this.symbolProvider.workspaceSymbols(params.query);
    const symbols = results.map(r => ({
      name: r.symbol.name,
      kind: symbolTypeToKind(r.symbol.type),
      location: {
        uri: `file://${r.symbol.location.filePath}`,
        range: {
          start: { line: r.symbol.location.line - 1, character: r.symbol.location.column },
          end: { line: r.symbol.location.endLine - 1, character: r.symbol.location.endColumn },
        },
      },
    }));
    this.connection.sendResponse(msg.id ?? null, symbols);
  }

  private onCodeAction(msg: LspMessage): void {
    const params = msg.params as { textDocument: { uri: string }; range: { start: { line: number; character: number }; end: { line: number; character: number } } };
    const actions = this.codeActionProvider.getCodeActions(params.textDocument.uri, params.range);
    this.connection.sendResponse(msg.id ?? null, actions);
  }
}

function extractWordAt(line: string, ch: number): string | null {
  const pattern = /\w+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index <= ch && ch <= match.index + match[0].length) {
      return match[0];
    }
  }
  return null;
}

function symbolTypeToKind(type: string): number {
  const kinds: Record<string, number> = {
    function: 12,
    method: 6,
    class: 5,
    interface: 11,
    type: 26,
    enum: 10,
    variable: 13,
    import: 9,
    export: 9,
  };
  return kinds[type] ?? 13;
}
