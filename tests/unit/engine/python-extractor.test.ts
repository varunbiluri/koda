import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getParser } from '../../../src/engine/ast/parser-manager.js';
import { PythonExtractor } from '../../../src/engine/ast/extractors/python-extractor.js';

const FIXTURE = path.resolve(__dirname, '../../fixtures/sample.py');

describe('PythonExtractor', () => {
  it('extracts classes, functions, and imports', async () => {
    const source = await fs.readFile(FIXTURE, 'utf-8');
    const parser = await getParser('python');
    expect(parser).not.toBeNull();

    const tree = parser!.parse(source);
    const extractor = new PythonExtractor();
    const result = extractor.extract(tree, source);

    const symbolTypes = result.symbols.map(s => `${s.type}:${s.name}`);

    // Imports
    expect(result.imports.length).toBeGreaterThanOrEqual(2);

    // Class
    expect(symbolTypes).toContain('class:DataProcessor');

    // Function
    expect(symbolTypes).toContain('function:find_files');

    // Variable
    expect(symbolTypes).toContain('variable:MAX_RETRIES');
  });
});
