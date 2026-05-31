import { describe, it, expect } from 'vitest';
import { buildRetrievalBootstrap, compressRepositoryContext } from '../../src/intelligence/retrieval-context.js';
import type { CodeChunk } from '../../src/types/code-chunk.js';

describe('buildRetrievalBootstrap', () => {
  it('builds paths and symbols without code excerpts', () => {
    const chunks: CodeChunk[] = [{
      id: 'a', filePath: 'src/auth.ts', name: 'login', type: 'function',
      content: 'function login() {}', startLine: 1, endLine: 1, language: 'typescript',
    }];
    const r = buildRetrievalBootstrap('fix auth login', chunks, null);
    expect(r.filePaths).toContain('src/auth.ts');
    expect(r.block).toContain('login');
    expect(r.block).not.toContain('function login()');
    expect(r.block).toContain('get_tool_result');
  });
});

describe('compressRepositoryContext', () => {
  it('truncates large architecture blocks', () => {
    const raw = '## Architecture\n' + 'x'.repeat(5000);
    const out = compressRepositoryContext(raw, 500);
    expect(out.length).toBeLessThanOrEqual(550);
  });
});
