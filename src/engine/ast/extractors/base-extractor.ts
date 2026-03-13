import type Parser from 'tree-sitter';
import type { ChunkType } from '../../../types/index.js';

export interface ExtractedSymbol {
  name: string;
  type: ChunkType;
  startLine: number;    // 1-based
  endLine: number;      // 1-based
  content: string;
}

export interface ImportInfo {
  source: string;       // Module specifier (e.g., './foo', 'lodash')
  symbols: string[];    // Imported names
}

export interface ExtractionResult {
  symbols: ExtractedSymbol[];
  imports: ImportInfo[];
}

export abstract class BaseExtractor {
  abstract extract(tree: Parser.Tree, source: string): ExtractionResult;

  protected getNodeText(node: Parser.SyntaxNode, source: string): string {
    return source.slice(node.startIndex, node.endIndex);
  }

  protected getNodeName(node: Parser.SyntaxNode, source: string): string {
    const nameNode =
      node.childForFieldName('name') ??
      node.children.find(c => c.type === 'identifier' || c.type === 'property_identifier');
    return nameNode ? this.getNodeText(nameNode, source) : 'anonymous';
  }

  protected nodeToSymbol(
    node: Parser.SyntaxNode,
    source: string,
    type: ChunkType,
    name?: string,
  ): ExtractedSymbol {
    return {
      name: name ?? this.getNodeName(node, source),
      type,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      content: this.getNodeText(node, source),
    };
  }
}
