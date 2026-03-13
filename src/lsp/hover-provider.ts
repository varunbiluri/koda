import type { DocumentStore } from './document-store.js';
import type { SymbolProvider } from './symbol-provider.js';

export interface Position {
  line: number;
  character: number;
}

export interface HoverResult {
  contents: { kind: 'markdown'; value: string };
  range?: {
    start: Position;
    end: Position;
  };
}

/**
 * HoverProvider - Resolves hover information for a document position.
 */
export class HoverProvider {
  constructor(
    private documentStore: DocumentStore,
    private symbolProvider: SymbolProvider,
  ) {}

  getHover(uri: string, position: Position): HoverResult | null {
    const doc = this.documentStore.get(uri);
    if (!doc) return null;

    const word = extractWordAtPosition(doc.text, position);
    if (!word) return null;

    const info = this.symbolProvider.getHoverInfo(word);
    if (!info) return null;

    const { symbol, definedIn, callers } = info;

    const lines: string[] = [];
    lines.push(`**${symbol.type}** \`${symbol.qualifiedName}\``);
    if (symbol.signature) {
      lines.push('', '```typescript', symbol.signature, '```');
    }
    if (symbol.docstring) {
      lines.push('', symbol.docstring);
    }
    lines.push('', `**Defined in:** \`${definedIn}\` line ${symbol.location.line}`);
    if (callers.length > 0) {
      lines.push('', `**Callers (${callers.length}):** ${callers.map(c => `\`${c.name}\``).join(', ')}`);
    }
    if (symbol.metadata.exported) {
      lines.push('', '_Exported symbol_');
    }

    return {
      contents: { kind: 'markdown', value: lines.join('\n') },
    };
  }
}

function extractWordAtPosition(text: string, position: Position): string | null {
  const lines = text.split('\n');
  const line = lines[position.line];
  if (!line) return null;

  const ch = position.character;
  const wordPattern = /\w+/g;
  let match: RegExpExecArray | null;

  while ((match = wordPattern.exec(line)) !== null) {
    if (match.index <= ch && ch <= match.index + match[0].length) {
      return match[0];
    }
  }

  return null;
}
