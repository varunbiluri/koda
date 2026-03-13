import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getParser } from '../../../src/engine/ast/parser-manager.js';
import { TypeScriptExtractor } from '../../../src/engine/ast/extractors/typescript-extractor.js';

const FIXTURE = path.resolve(__dirname, '../../fixtures/sample.ts');

describe('TypeScriptExtractor', () => {
  it('extracts functions, classes, interfaces, types, enums, and imports', async () => {
    const source = await fs.readFile(FIXTURE, 'utf-8');
    const parser = await getParser('typescript');
    expect(parser).not.toBeNull();

    const tree = parser!.parse(source);
    const extractor = new TypeScriptExtractor();
    const result = extractor.extract(tree, source);

    const symbolNames = result.symbols.map(s => s.name);
    const symbolTypes = result.symbols.map(s => `${s.type}:${s.name}`);

    // Imports
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
    expect(result.imports[0].source).toBe('node:fs/promises');

    // Interface
    expect(symbolTypes).toContain('interface:UserConfig');

    // Type alias
    expect(symbolTypes).toContain('type_alias:UserId');

    // Enum
    expect(symbolTypes).toContain('enum:Role');

    // Class
    expect(symbolTypes).toContain('class:UserService');

    // Function
    expect(symbolTypes).toContain('function:createDefaultUser');

    // Arrow function assigned to const
    expect(symbolNames).toContain('getUserRole');
  });

  it('tracks start and end lines', async () => {
    const source = await fs.readFile(FIXTURE, 'utf-8');
    const parser = await getParser('typescript');
    const tree = parser!.parse(source);
    const extractor = new TypeScriptExtractor();
    const result = extractor.extract(tree, source);

    for (const sym of result.symbols) {
      expect(sym.startLine).toBeGreaterThan(0);
      expect(sym.endLine).toBeGreaterThanOrEqual(sym.startLine);
      expect(sym.content.length).toBeGreaterThan(0);
    }
  });
});
