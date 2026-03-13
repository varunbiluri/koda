import type Parser from 'tree-sitter';
import { BaseExtractor, type ExtractionResult, type ExtractedSymbol, type ImportInfo } from './base-extractor.js';

export class TypeScriptExtractor extends BaseExtractor {
  extract(tree: Parser.Tree, source: string): ExtractionResult {
    const symbols: ExtractedSymbol[] = [];
    const imports: ImportInfo[] = [];

    this.visit(tree.rootNode, source, symbols, imports);
    return { symbols, imports };
  }

  private visit(
    node: Parser.SyntaxNode,
    source: string,
    symbols: ExtractedSymbol[],
    imports: ImportInfo[],
  ): void {
    switch (node.type) {
      case 'function_declaration':
      case 'generator_function_declaration':
        symbols.push(this.nodeToSymbol(node, source, 'function'));
        return; // Don't recurse into function body

      case 'class_declaration':
        symbols.push(this.nodeToSymbol(node, source, 'class'));
        return;

      case 'interface_declaration':
        symbols.push(this.nodeToSymbol(node, source, 'interface'));
        return;

      case 'type_alias_declaration':
        symbols.push(this.nodeToSymbol(node, source, 'type_alias'));
        return;

      case 'enum_declaration':
        symbols.push(this.nodeToSymbol(node, source, 'enum'));
        return;

      case 'import_statement':
        imports.push(this.extractImport(node, source));
        symbols.push(this.nodeToSymbol(node, source, 'import'));
        return;

      case 'export_statement': {
        // Check if this exports a declaration (export function, export class, etc.)
        const decl = node.childForFieldName('declaration') ??
          node.children.find(c =>
            c.type === 'function_declaration' ||
            c.type === 'class_declaration' ||
            c.type === 'interface_declaration' ||
            c.type === 'type_alias_declaration' ||
            c.type === 'enum_declaration' ||
            c.type === 'lexical_declaration'
          );

        if (decl) {
          // Extract the inner declaration as the symbol
          this.visit(decl, source, symbols, imports);
        } else {
          symbols.push(this.nodeToSymbol(node, source, 'export'));
        }
        return;
      }

      case 'lexical_declaration':
      case 'variable_declaration': {
        // Extract variable/const declarations at top level
        if (this.isTopLevel(node)) {
          // Check for arrow functions or function expressions
          const declarators = node.children.filter(c => c.type === 'variable_declarator');
          for (const d of declarators) {
            const value = d.childForFieldName('value');
            if (value && (value.type === 'arrow_function' || value.type === 'function_expression')) {
              symbols.push(this.nodeToSymbol(node, source, 'function', this.getNodeName(d, source)));
            } else {
              symbols.push(this.nodeToSymbol(node, source, 'variable', this.getNodeName(d, source)));
            }
          }
        }
        return;
      }
    }

    // Recurse into children for container nodes
    for (const child of node.children) {
      this.visit(child, source, symbols, imports);
    }
  }

  private isTopLevel(node: Parser.SyntaxNode): boolean {
    const parent = node.parent;
    if (!parent) return true;
    return parent.type === 'program' || parent.type === 'export_statement';
  }

  private extractImport(node: Parser.SyntaxNode, source: string): ImportInfo {
    const sourceNode = node.childForFieldName('source') ??
      node.children.find(c => c.type === 'string');
    const moduleSpecifier = sourceNode
      ? this.getNodeText(sourceNode, source).replace(/['"]/g, '')
      : '';

    const symbols: string[] = [];
    const importClause = node.children.find(c => c.type === 'import_clause');
    if (importClause) {
      for (const child of importClause.children) {
        if (child.type === 'identifier') {
          symbols.push(this.getNodeText(child, source));
        }
        if (child.type === 'named_imports') {
          for (const specifier of child.children) {
            if (specifier.type === 'import_specifier') {
              const name = specifier.childForFieldName('name') ?? specifier.children[0];
              if (name) symbols.push(this.getNodeText(name, source));
            }
          }
        }
        if (child.type === 'namespace_import') {
          const name = child.children.find(c => c.type === 'identifier');
          if (name) symbols.push('* as ' + this.getNodeText(name, source));
        }
      }
    }

    return { source: moduleSpecifier, symbols };
  }
}
