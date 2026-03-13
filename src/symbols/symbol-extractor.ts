import type { SyntaxNode } from 'tree-sitter';
import type { SymbolRecord, SymbolType, SymbolLocation, SymbolExtractionResult } from './types.js';
import { getParser } from '../engine/ast/parser-manager.js';

/**
 * SymbolExtractor - Extracts symbols from source code AST
 *
 * Extracts: functions, classes, methods, interfaces, imports, exports
 */
export class SymbolExtractor {
  /**
   * Extract symbols from a file
   */
  async extractFromFile(
    filePath: string,
    content: string,
    language: string,
  ): Promise<SymbolExtractionResult> {
    const symbols: SymbolRecord[] = [];
    const imports = new Map<string, string[]>();
    const exports = new Map<string, string[]>();
    const errors: string[] = [];

    try {
      // Parse file
      const parser = await getParser(language);
      if (!parser) {
        errors.push(`No parser available for language: ${language}`);
        return { symbols, imports, exports, errors };
      }

      const tree = parser.parse(content);

      // Extract symbols based on language
      if (language === 'typescript' || language === 'javascript') {
        this.extractTypeScriptSymbols(filePath, tree.rootNode, content, symbols, imports, exports);
      } else if (language === 'python') {
        this.extractPythonSymbols(filePath, tree.rootNode, content, symbols, imports, exports);
      }

      // Build caller relationships
      this.buildCallerRelationships(symbols);
    } catch (error) {
      errors.push(`Failed to extract symbols: ${(error as Error).message}`);
    }

    return { symbols, imports, exports, errors };
  }

  /**
   * Extract TypeScript/JavaScript symbols
   */
  private extractTypeScriptSymbols(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
    imports: Map<string, string[]>,
    exports: Map<string, string[]>,
  ): void {
    // Extract imports
    if (node.type === 'import_statement') {
      this.extractTypeScriptImport(filePath, node, content, symbols, imports);
    }

    // Extract exports
    if (node.type === 'export_statement') {
      this.extractTypeScriptExport(filePath, node, content, symbols, exports);
    }

    // Extract functions
    if (node.type === 'function_declaration' || node.type === 'function') {
      this.extractTypeScriptFunction(filePath, node, content, symbols);
    }

    // Extract classes
    if (node.type === 'class_declaration') {
      this.extractTypeScriptClass(filePath, node, content, symbols);
    }

    // Extract interfaces
    if (node.type === 'interface_declaration') {
      this.extractTypeScriptInterface(filePath, node, content, symbols);
    }

    // Extract type aliases
    if (node.type === 'type_alias_declaration') {
      this.extractTypeScriptType(filePath, node, content, symbols);
    }

    // Extract enums
    if (node.type === 'enum_declaration') {
      this.extractTypeScriptEnum(filePath, node, content, symbols);
    }

    // Recurse into children
    for (const child of node.children) {
      this.extractTypeScriptSymbols(filePath, child, content, symbols, imports, exports);
    }
  }

  /**
   * Extract TypeScript import
   */
  private extractTypeScriptImport(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
    imports: Map<string, string[]>,
  ): void {
    const importClause = node.childForFieldName('import_clause');
    const source = node.childForFieldName('source');

    if (!source) return;

    const modulePath = content.substring(source.startIndex, source.endIndex).replace(/['"]/g, '');
    const importedSymbols: string[] = [];

    if (importClause) {
      // Named imports
      const namedImports = importClause.descendantsOfType('import_specifier');
      for (const spec of namedImports) {
        const name = spec.childForFieldName('name');
        if (name) {
          const symbolName = content.substring(name.startIndex, name.endIndex);
          importedSymbols.push(symbolName);

          // Create import symbol record
          symbols.push({
            id: `${filePath}#import_${symbolName}`,
            name: symbolName,
            qualifiedName: symbolName,
            type: 'import',
            location: this.nodeToLocation(filePath, node),
            modifiers: [],
            references: [],
            callers: new Set(),
            metadata: {
              exported: false,
              imported: true,
            },
          });
        }
      }

      // Default import
      const defaultImport = importClause.descendantsOfType('identifier')[0];
      if (defaultImport && defaultImport.parent?.type === 'import_clause') {
        const symbolName = content.substring(defaultImport.startIndex, defaultImport.endIndex);
        importedSymbols.push(symbolName);
      }
    }

    imports.set(modulePath, importedSymbols);
  }

  /**
   * Extract TypeScript export
   */
  private extractTypeScriptExport(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
    exports: Map<string, string[]>,
  ): void {
    const declaration = node.childForFieldName('declaration');

    if (declaration) {
      // Extract the exported symbol
      const name = this.getNodeName(declaration, content);
      if (name) {
        const exportedSymbols = exports.get(filePath) || [];
        exportedSymbols.push(name);
        exports.set(filePath, exportedSymbols);

        // Mark as exported
        const symbolId = `${filePath}#${name}`;
        const existingSymbol = symbols.find((s) => s.id === symbolId);
        if (existingSymbol) {
          existingSymbol.metadata.exported = true;
        }
      }
    }
  }

  /**
   * Extract TypeScript function
   */
  private extractTypeScriptFunction(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
    parent?: string,
  ): void {
    const name = node.childForFieldName('name');
    if (!name) return;

    const functionName = content.substring(name.startIndex, name.endIndex);
    const signature = this.extractSignature(node, content);
    const references = this.extractReferences(node, content);

    symbols.push({
      id: `${filePath}#${functionName}`,
      name: functionName,
      qualifiedName: parent ? `${parent}.${functionName}` : functionName,
      type: 'function',
      location: this.nodeToLocation(filePath, node),
      signature,
      modifiers: this.extractModifiers(node, content),
      parent,
      references,
      callers: new Set(),
      metadata: {
        exported: false,
        imported: false,
      },
    });
  }

  /**
   * Extract TypeScript class
   */
  private extractTypeScriptClass(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
  ): void {
    const name = node.childForFieldName('name');
    if (!name) return;

    const className = content.substring(name.startIndex, name.endIndex);
    const classId = `${filePath}#${className}`;

    symbols.push({
      id: classId,
      name: className,
      qualifiedName: className,
      type: 'class',
      location: this.nodeToLocation(filePath, node),
      modifiers: this.extractModifiers(node, content),
      references: [],
      callers: new Set(),
      metadata: {
        exported: false,
        imported: false,
      },
    });

    // Extract methods
    const methods = node.descendantsOfType('method_definition');
    for (const method of methods) {
      const methodName = method.childForFieldName('name');
      if (methodName) {
        const name = content.substring(methodName.startIndex, methodName.endIndex);
        const signature = this.extractSignature(method, content);
        const references = this.extractReferences(method, content);

        symbols.push({
          id: `${filePath}#${className}.${name}`,
          name,
          qualifiedName: `${className}.${name}`,
          type: 'method',
          location: this.nodeToLocation(filePath, method),
          signature,
          modifiers: this.extractModifiers(method, content),
          parent: classId,
          references,
          callers: new Set(),
          metadata: {
            exported: false,
            imported: false,
          },
        });
      }
    }
  }

  /**
   * Extract TypeScript interface
   */
  private extractTypeScriptInterface(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
  ): void {
    const name = node.childForFieldName('name');
    if (!name) return;

    const interfaceName = content.substring(name.startIndex, name.endIndex);

    symbols.push({
      id: `${filePath}#${interfaceName}`,
      name: interfaceName,
      qualifiedName: interfaceName,
      type: 'interface',
      location: this.nodeToLocation(filePath, node),
      modifiers: this.extractModifiers(node, content),
      references: [],
      callers: new Set(),
      metadata: {
        exported: false,
        imported: false,
      },
    });
  }

  /**
   * Extract TypeScript type alias
   */
  private extractTypeScriptType(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
  ): void {
    const name = node.childForFieldName('name');
    if (!name) return;

    const typeName = content.substring(name.startIndex, name.endIndex);

    symbols.push({
      id: `${filePath}#${typeName}`,
      name: typeName,
      qualifiedName: typeName,
      type: 'type',
      location: this.nodeToLocation(filePath, node),
      modifiers: [],
      references: [],
      callers: new Set(),
      metadata: {
        exported: false,
        imported: false,
      },
    });
  }

  /**
   * Extract TypeScript enum
   */
  private extractTypeScriptEnum(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
  ): void {
    const name = node.childForFieldName('name');
    if (!name) return;

    const enumName = content.substring(name.startIndex, name.endIndex);

    symbols.push({
      id: `${filePath}#${enumName}`,
      name: enumName,
      qualifiedName: enumName,
      type: 'enum',
      location: this.nodeToLocation(filePath, node),
      modifiers: [],
      references: [],
      callers: new Set(),
      metadata: {
        exported: false,
        imported: false,
      },
    });
  }

  /**
   * Extract Python symbols
   */
  private extractPythonSymbols(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
    imports: Map<string, string[]>,
    exports: Map<string, string[]>,
  ): void {
    // Extract functions
    if (node.type === 'function_definition') {
      this.extractPythonFunction(filePath, node, content, symbols);
    }

    // Extract classes
    if (node.type === 'class_definition') {
      this.extractPythonClass(filePath, node, content, symbols);
    }

    // Extract imports
    if (node.type === 'import_statement' || node.type === 'import_from_statement') {
      this.extractPythonImport(filePath, node, content, imports);
    }

    // Recurse
    for (const child of node.children) {
      this.extractPythonSymbols(filePath, child, content, symbols, imports, exports);
    }
  }

  /**
   * Extract Python function
   */
  private extractPythonFunction(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
    parent?: string,
  ): void {
    const name = node.childForFieldName('name');
    if (!name) return;

    const functionName = content.substring(name.startIndex, name.endIndex);
    const signature = this.extractSignature(node, content);
    const references = this.extractReferences(node, content);

    symbols.push({
      id: `${filePath}#${functionName}`,
      name: functionName,
      qualifiedName: parent ? `${parent}.${functionName}` : functionName,
      type: parent ? 'method' : 'function',
      location: this.nodeToLocation(filePath, node),
      signature,
      modifiers: [],
      parent,
      references,
      callers: new Set(),
      metadata: {
        exported: false,
        imported: false,
      },
    });
  }

  /**
   * Extract Python class
   */
  private extractPythonClass(
    filePath: string,
    node: SyntaxNode,
    content: string,
    symbols: SymbolRecord[],
  ): void {
    const name = node.childForFieldName('name');
    if (!name) return;

    const className = content.substring(name.startIndex, name.endIndex);
    const classId = `${filePath}#${className}`;

    symbols.push({
      id: classId,
      name: className,
      qualifiedName: className,
      type: 'class',
      location: this.nodeToLocation(filePath, node),
      modifiers: [],
      references: [],
      callers: new Set(),
      metadata: {
        exported: false,
        imported: false,
      },
    });

    // Extract methods
    const methods = node.descendantsOfType('function_definition');
    for (const method of methods) {
      this.extractPythonFunction(filePath, method, content, symbols, classId);
    }
  }

  /**
   * Extract Python import
   */
  private extractPythonImport(
    filePath: string,
    node: SyntaxNode,
    content: string,
    imports: Map<string, string[]>,
  ): void {
    const moduleName = node.childForFieldName('module_name');
    if (!moduleName) return;

    const module = content.substring(moduleName.startIndex, moduleName.endIndex);
    const importedSymbols = imports.get(module) || [];

    // Get imported names
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      const names = nameNode.descendantsOfType('dotted_name');
      for (const name of names) {
        const symbolName = content.substring(name.startIndex, name.endIndex);
        importedSymbols.push(symbolName);
      }
    }

    imports.set(module, importedSymbols);
  }

  /**
   * Helper: Get node name
   */
  private getNodeName(node: SyntaxNode, content: string): string | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return content.substring(nameNode.startIndex, nameNode.endIndex);
  }

  /**
   * Helper: Extract function signature
   */
  private extractSignature(node: SyntaxNode, content: string): string {
    const params = node.childForFieldName('parameters');
    if (!params) return '()';

    return content.substring(params.startIndex, params.endIndex);
  }

  /**
   * Helper: Extract modifiers (public, private, static, etc.)
   */
  private extractModifiers(node: SyntaxNode, content: string): string[] {
    const modifiers: string[] = [];

    // Check for accessibility modifiers
    const siblings = node.parent?.children || [];
    for (const sibling of siblings) {
      if (sibling.type === 'accessibility_modifier') {
        modifiers.push(content.substring(sibling.startIndex, sibling.endIndex));
      }
      if (sibling.type === 'static') {
        modifiers.push('static');
      }
      if (sibling.type === 'async') {
        modifiers.push('async');
      }
    }

    return modifiers;
  }

  /**
   * Helper: Extract symbol references from function body
   */
  private extractReferences(node: SyntaxNode, content: string): string[] {
    const references = new Set<string>();

    // Find all identifiers (potential function/variable references)
    const identifiers = node.descendantsOfType('identifier');

    for (const id of identifiers) {
      // Skip if it's a definition
      if (id.parent?.type === 'function_declaration' || id.parent?.type === 'variable_declarator') {
        continue;
      }

      const name = content.substring(id.startIndex, id.endIndex);
      references.add(name);
    }

    return Array.from(references);
  }

  /**
   * Helper: Convert tree-sitter node to location
   */
  private nodeToLocation(filePath: string, node: SyntaxNode): SymbolLocation {
    return {
      filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
    };
  }

  /**
   * Build caller relationships
   */
  private buildCallerRelationships(symbols: SymbolRecord[]): void {
    const symbolMap = new Map(symbols.map((s) => [s.name, s]));

    for (const symbol of symbols) {
      // For each reference, add this symbol as a caller
      for (const refName of symbol.references) {
        const referenced = symbolMap.get(refName);
        if (referenced) {
          referenced.callers.add(symbol.id);
        }
      }
    }
  }
}
