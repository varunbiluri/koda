import { describe, it, expect } from 'vitest';
import { createChunks } from '../../../src/engine/chunking/chunker.js';
import type { ExtractedSymbol } from '../../../src/engine/ast/extractors/base-extractor.js';

describe('chunker', () => {
  it('creates chunks from symbols', () => {
    const source = `// header comment
function foo() {
  return 1;
}

function bar() {
  return 2;
}
// trailing`;

    const symbols: ExtractedSymbol[] = [
      { name: 'foo', type: 'function', startLine: 2, endLine: 4, content: 'function foo() {\n  return 1;\n}' },
      { name: 'bar', type: 'function', startLine: 6, endLine: 8, content: 'function bar() {\n  return 2;\n}' },
    ];

    const chunks = createChunks('test.ts', 'typescript', symbols, source);

    const named = chunks.filter(c => c.type === 'function');
    expect(named).toHaveLength(2);
    expect(named[0].name).toBe('foo');
    expect(named[1].name).toBe('bar');

    // Should have misc chunks for uncovered lines
    const misc = chunks.filter(c => c.type === 'misc');
    expect(misc.length).toBeGreaterThan(0);
  });

  it('skips import chunks', () => {
    const source = `import { foo } from './foo';
const x = 1;`;

    const symbols: ExtractedSymbol[] = [
      { name: 'import_foo', type: 'import', startLine: 1, endLine: 1, content: "import { foo } from './foo';" },
      { name: 'x', type: 'variable', startLine: 2, endLine: 2, content: 'const x = 1;' },
    ];

    const chunks = createChunks('test.ts', 'typescript', symbols, source);
    expect(chunks.find(c => c.type === 'import')).toBeUndefined();
    expect(chunks.find(c => c.name === 'x')).toBeDefined();
  });
});
