import { describe, it, expect } from 'vitest';
import { buildContext, formatFileReferences } from '../../src/context/context-builder.js';
import type { CodeChunk } from '../../src/types/index.js';

describe('buildContext', () => {
  it('builds context from code chunks', () => {
    const chunks: CodeChunk[] = [
      {
        id: 'foo.ts#bar',
        filePath: 'foo.ts',
        name: 'bar',
        type: 'function',
        content: 'function bar() { return 42; }',
        startLine: 1,
        endLine: 3,
        language: 'typescript',
      },
      {
        id: 'foo.ts#baz',
        filePath: 'foo.ts',
        name: 'baz',
        type: 'function',
        content: 'function baz() { return 100; }',
        startLine: 5,
        endLine: 7,
        language: 'typescript',
      },
    ];

    const result = buildContext(chunks, 10000);

    expect(result.context).toContain('## File: foo.ts');
    expect(result.context).toContain('### function: bar');
    expect(result.context).toContain('### function: baz');
    expect(result.context).toContain('function bar() { return 42; }');
    expect(result.chunks).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it('truncates context when exceeding token limit', () => {
    const chunks: CodeChunk[] = Array.from({ length: 100 }, (_, i) => ({
      id: `file${i}.ts#func${i}`,
      filePath: `file${i}.ts`,
      name: `func${i}`,
      type: 'function' as const,
      content: 'x'.repeat(1000), // Large content
      startLine: 1,
      endLine: 10,
      language: 'typescript',
    }));

    const result = buildContext(chunks, 500); // Small token limit

    expect(result.truncated).toBe(true);
    expect(result.chunks.length).toBeLessThan(chunks.length);
    expect(result.estimatedTokens).toBeLessThanOrEqual(500);
  });

  it('groups chunks by file', () => {
    const chunks: CodeChunk[] = [
      {
        id: 'a.ts#foo',
        filePath: 'a.ts',
        name: 'foo',
        type: 'function',
        content: 'function foo() {}',
        startLine: 1,
        endLine: 1,
        language: 'typescript',
      },
      {
        id: 'b.ts#bar',
        filePath: 'b.ts',
        name: 'bar',
        type: 'function',
        content: 'function bar() {}',
        startLine: 1,
        endLine: 1,
        language: 'typescript',
      },
      {
        id: 'a.ts#baz',
        filePath: 'a.ts',
        name: 'baz',
        type: 'function',
        content: 'function baz() {}',
        startLine: 3,
        endLine: 3,
        language: 'typescript',
      },
    ];

    const result = buildContext(chunks, 10000);

    // Check that file headers appear in the right order
    const aFileIndex = result.context.indexOf('## File: a.ts');
    const bFileIndex = result.context.indexOf('## File: b.ts');
    const fooIndex = result.context.indexOf('### function: foo');
    const bazIndex = result.context.indexOf('### function: baz');

    expect(aFileIndex).toBeGreaterThan(-1);
    expect(bFileIndex).toBeGreaterThan(-1);
    expect(fooIndex).toBeGreaterThan(aFileIndex);
    expect(bazIndex).toBeGreaterThan(aFileIndex);
  });
});

describe('formatFileReferences', () => {
  it('formats file references as a numbered list', () => {
    const chunks = [
      { filePath: 'a.ts', name: 'foo', type: 'function', content: '', startLine: 1, endLine: 1 },
      { filePath: 'b.ts', name: 'bar', type: 'function', content: '', startLine: 1, endLine: 1 },
      { filePath: 'a.ts', name: 'baz', type: 'function', content: '', startLine: 3, endLine: 3 },
    ];

    const result = formatFileReferences(chunks);

    expect(result).toContain('1. a.ts');
    expect(result).toContain('2. b.ts');
    expect(result.split('\n')).toHaveLength(2); // Only 2 unique files
  });
});
