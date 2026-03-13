import type Parser from 'tree-sitter';
import { BaseExtractor, type ExtractionResult, type ExtractedSymbol, type ImportInfo } from './base-extractor.js';

export class PythonExtractor extends BaseExtractor {
  extract(tree: Parser.Tree, source: string): ExtractionResult {
    const symbols: ExtractedSymbol[] = [];
    const imports: ImportInfo[] = [];

    for (const node of tree.rootNode.children) {
      switch (node.type) {
        case 'function_definition':
          symbols.push(this.nodeToSymbol(node, source, 'function'));
          break;

        case 'class_definition':
          symbols.push(this.nodeToSymbol(node, source, 'class'));
          break;

        case 'decorated_definition': {
          const inner = node.children.find(c =>
            c.type === 'function_definition' || c.type === 'class_definition'
          );
          if (inner) {
            const type = inner.type === 'function_definition' ? 'function' : 'class';
            symbols.push(this.nodeToSymbol(node, source, type, this.getNodeName(inner, source)));
          }
          break;
        }

        case 'import_statement':
        case 'import_from_statement':
          imports.push(this.extractImport(node, source));
          symbols.push(this.nodeToSymbol(node, source, 'import'));
          break;

        case 'expression_statement': {
          // Top-level assignments
          const expr = node.children[0];
          if (expr && expr.type === 'assignment') {
            const left = expr.children[0];
            if (left) {
              symbols.push(this.nodeToSymbol(node, source, 'variable', this.getNodeText(left, source)));
            }
          }
          break;
        }
      }
    }

    return { symbols, imports };
  }

  private extractImport(node: Parser.SyntaxNode, source: string): ImportInfo {
    if (node.type === 'import_statement') {
      // import foo, import foo.bar
      const names = node.children
        .filter(c => c.type === 'dotted_name')
        .map(c => this.getNodeText(c, source));
      return {
        source: names[0] ?? '',
        symbols: names,
      };
    }

    // from foo import bar, baz
    const moduleNode = node.children.find(c => c.type === 'dotted_name' || c.type === 'relative_import');
    const moduleName = moduleNode ? this.getNodeText(moduleNode, source) : '';

    const symbols: string[] = [];
    for (const child of node.children) {
      if (child.type === 'dotted_name' && child !== moduleNode) {
        symbols.push(this.getNodeText(child, source));
      }
      if (child.type === 'import_prefix') continue;
      if (child.type === 'wildcard_import') {
        symbols.push('*');
      }
    }

    // Also check for aliased imports
    const aliases = node.children.filter(c => c.type === 'aliased_import');
    for (const alias of aliases) {
      const name = alias.childForFieldName('name') ?? alias.children[0];
      if (name) symbols.push(this.getNodeText(name, source));
    }

    return { source: moduleName, symbols };
  }
}
