/**
 * Tests for ToolResultIndex.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolResultIndex } from '../../src/runtime/tool-result-index.js';

describe('ToolResultIndex.store()', () => {
  let idx: ToolResultIndex;

  beforeEach(() => { idx = new ToolResultIndex(); });

  it('returns a ref with incrementing id', () => {
    const ref1 = idx.store('n1', 'read_file', { path: 'a.ts' }, 'content a');
    const ref2 = idx.store('n1', 'read_file', { path: 'b.ts' }, 'content b');
    expect(ref1.id).toBe('result_1');
    expect(ref2.id).toBe('result_2');
  });

  it('returns a ref with correct tool name', () => {
    const ref = idx.store('n1', 'run_terminal', { command: 'pnpm test' }, 'PASS');
    expect(ref.tool).toBe('run_terminal');
  });

  it('builds a description string', () => {
    const ref = idx.store('n1', 'read_file', { path: 'src/auth.ts' }, 'line1\nline2\nline3');
    expect(ref.description).toContain('read_file');
    expect(ref.description).toContain('src/auth.ts');
  });
});

describe('ToolResultIndex.getOutput()', () => {
  let idx: ToolResultIndex;

  beforeEach(() => { idx = new ToolResultIndex(); });

  it('returns stored output for known id', () => {
    const ref = idx.store('n1', 'read_file', { path: 'f.ts' }, 'hello world');
    expect(idx.getOutput(ref.id)).toBe('hello world');
  });

  it('truncates large outputs', () => {
    const bigContent = 'x'.repeat(10_000);
    const ref = idx.store('n1', 'read_file', { path: 'big.ts' }, bigContent);
    const out = idx.getOutput(ref.id);
    expect(out.length).toBeLessThan(bigContent.length);
    expect(out).toContain('truncated');
  });

  it('returns not-found message for unknown id', () => {
    expect(idx.getOutput('result_999')).toContain('not found');
  });
});

describe('ToolResultIndex.get()', () => {
  it('returns full ToolResult with metadata', () => {
    const idx = new ToolResultIndex();
    const ref = idx.store('node_a', 'git_diff', { args: '--staged' }, 'diff output');
    const r   = idx.get(ref.id)!;
    expect(r.nodeId).toBe('node_a');
    expect(r.tool).toBe('git_diff');
    expect(r.output).toBe('diff output');
    expect(r.sizeBytes).toBe('diff output'.length);
    expect(r.timestamp).toBeGreaterThan(0);
  });

  it('returns undefined for unknown id', () => {
    const idx = new ToolResultIndex();
    expect(idx.get('result_0')).toBeUndefined();
  });
});

describe('ToolResultIndex.query()', () => {
  let idx: ToolResultIndex;

  beforeEach(() => {
    idx = new ToolResultIndex();
    idx.store('node_a', 'read_file',    { path: 'src/auth.ts' },   'auth content');
    idx.store('node_a', 'run_terminal', { command: 'pnpm test' },   'test output');
    idx.store('node_b', 'read_file',    { path: 'src/utils.ts' },  'utils content');
  });

  it('filters by nodeId', () => {
    const results = idx.query({ nodeId: 'node_a' });
    expect(results.every((r) => r.nodeId === 'node_a')).toBe(true);
    expect(results).toHaveLength(2);
  });

  it('filters by toolFilter', () => {
    const results = idx.query({ toolFilter: 'read_file' });
    expect(results.every((r) => r.tool === 'read_file')).toBe(true);
    expect(results).toHaveLength(2);
  });

  it('filters by pattern', () => {
    const results = idx.query({ pattern: 'auth' });
    expect(results).toHaveLength(1);
    expect(results[0].args['path']).toBe('src/auth.ts');
  });

  it('respects limit', () => {
    const results = idx.query({ limit: 1 });
    expect(results).toHaveLength(1);
  });

  it('returns empty array when no matches', () => {
    expect(idx.query({ nodeId: 'node_c' })).toHaveLength(0);
  });
});

describe('ToolResultIndex.buildContextRefs()', () => {
  it('builds multi-line reference string', () => {
    const idx  = new ToolResultIndex();
    const ref1 = idx.store('n', 'read_file', { path: 'a.ts' }, 'content\nmore');
    const ref2 = idx.store('n', 'run_terminal', { command: 'test' }, 'PASS');
    const refs = idx.buildContextRefs([ref1.id, ref2.id]);
    expect(refs).toContain('result_1');
    expect(refs).toContain('result_2');
    expect(refs.split('\n')).toHaveLength(2);
  });

  it('includes not-found for missing ids', () => {
    const idx  = new ToolResultIndex();
    const refs = idx.buildContextRefs(['result_99']);
    expect(refs).toContain('not found');
  });
});

describe('ToolResultIndex.getStats()', () => {
  it('returns correct total and totalBytes', () => {
    const idx = new ToolResultIndex();
    idx.store('n', 'tool', {}, 'abc');  // 3 bytes
    idx.store('n', 'tool', {}, 'defg'); // 4 bytes
    const stats = idx.getStats();
    expect(stats.total).toBe(2);
    expect(stats.totalBytes).toBe(7);
  });
});

describe('ToolResultIndex.clear()', () => {
  it('removes all results', () => {
    const idx = new ToolResultIndex();
    idx.store('n', 'tool', {}, 'data');
    idx.clear();
    expect(idx.getStats().total).toBe(0);
  });

  it('resets the counter after clear', () => {
    const idx = new ToolResultIndex();
    idx.store('n', 'tool', {}, 'data');
    idx.clear();
    const ref = idx.store('n', 'tool', {}, 'new');
    expect(ref.id).toBe('result_1');
  });
});

describe('ToolResultIndex.clearNode()', () => {
  it('removes only results from the specified node', () => {
    const idx = new ToolResultIndex();
    idx.store('node_a', 'tool', {}, 'a');
    idx.store('node_b', 'tool', {}, 'b');
    idx.clearNode('node_a');
    expect(idx.query({ nodeId: 'node_a' })).toHaveLength(0);
    expect(idx.query({ nodeId: 'node_b' })).toHaveLength(1);
  });
});
