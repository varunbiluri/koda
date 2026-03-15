import { describe, it, expect } from 'vitest';
import { QueryEngine } from '../../../src/search/query-engine.js';
import type { RepoIndex } from '../../../src/types/index.js';

function makeTestIndex(): RepoIndex {
  return {
    metadata: {
      version: '0.1.1',
      createdAt: new Date().toISOString(),
      rootPath: '/test',
      fileCount: 2,
      chunkCount: 3,
      edgeCount: 0,
    },
    files: [
      { path: 'auth.ts', absolutePath: '/test/auth.ts', language: 'typescript', size: 100, hash: 'a' },
      { path: 'utils.ts', absolutePath: '/test/utils.ts', language: 'typescript', size: 50, hash: 'b' },
    ],
    chunks: [
      { id: 'auth.ts#authenticate', filePath: 'auth.ts', name: 'authenticate', type: 'function', content: 'function authenticate(user, password) { ... }', startLine: 1, endLine: 3, language: 'typescript' },
      { id: 'auth.ts#validateToken', filePath: 'auth.ts', name: 'validateToken', type: 'function', content: 'function validateToken(token) { ... }', startLine: 5, endLine: 8, language: 'typescript' },
      { id: 'utils.ts#formatDate', filePath: 'utils.ts', name: 'formatDate', type: 'function', content: 'function formatDate(date) { return date.toISOString(); }', startLine: 1, endLine: 3, language: 'typescript' },
    ],
    edges: [],
    nodes: [
      { filePath: 'auth.ts', inDegree: 2, outDegree: 1 },
      { filePath: 'utils.ts', inDegree: 0, outDegree: 0 },
    ],
    vectors: [],
    vocabulary: { terms: [], termToIndex: {} },
  };
}

describe('QueryEngine', () => {
  it('can be constructed with an index', () => {
    const index = makeTestIndex();
    const engine = new QueryEngine(index);
    expect(engine).toBeDefined();
  });

  it('returns empty array for query with no vocabulary match', () => {
    const index = makeTestIndex();
    const engine = new QueryEngine(index);
    const results = engine.search('xyznonexistent', 5);
    expect(results).toHaveLength(0);
  });
});
