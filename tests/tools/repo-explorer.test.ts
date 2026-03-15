/**
 * Tests for RepoExplorer.
 *
 * Uses a small in-memory filesystem stub so tests don't touch the real disk.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepoExplorer } from '../../src/tools/repo-explorer.js';

// ── Filesystem mock ───────────────────────────────────────────────────────────

const MOCK_FS: Record<string, string | null> = {
  'src/auth.ts':              'export function login() { return true; }',
  'src/index.ts':             'import { login } from "./auth";',
  'src/utils/helpers.ts':     'export const UTIL = 1;',
  'tests/auth.test.ts':       'describe("auth", () => { it("works", () => {}); });',
  'package.json':             '{ "name": "test-repo" }',
};

// Simulate readdir results
const DIR_CONTENTS: Record<string, Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>> = {
  '/repo': [
    { name: 'src',          isDirectory: () => true,  isFile: () => false },
    { name: 'tests',        isDirectory: () => true,  isFile: () => false },
    { name: 'package.json', isDirectory: () => false, isFile: () => true  },
  ],
  '/repo/src': [
    { name: 'auth.ts',   isDirectory: () => false, isFile: () => true },
    { name: 'index.ts',  isDirectory: () => false, isFile: () => true },
    { name: 'utils',     isDirectory: () => true,  isFile: () => false },
  ],
  '/repo/src/utils': [
    { name: 'helpers.ts', isDirectory: () => false, isFile: () => true },
  ],
  '/repo/tests': [
    { name: 'auth.test.ts', isDirectory: () => false, isFile: () => true },
  ],
};

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn((dir: string) => {
    const entries = DIR_CONTENTS[dir];
    if (!entries) return Promise.reject(new Error(`ENOENT: ${dir}`));
    return Promise.resolve(entries);
  }),
  readFile: vi.fn((filePath: string) => {
    // Convert absolute path to mock key
    const key = Object.keys(MOCK_FS).find((k) => filePath.endsWith(k));
    if (key) return Promise.resolve(MOCK_FS[key]);
    return Promise.reject(new Error(`ENOENT: ${filePath}`));
  }),
  stat: vi.fn((filePath: string) => {
    const key = Object.keys(MOCK_FS).find((k) => filePath.endsWith(k));
    if (key) return Promise.resolve({ size: (MOCK_FS[key] ?? '').length, isFile: () => true });
    return Promise.resolve({ size: 0, isFile: () => false });
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RepoExplorer.searchFiles()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds TypeScript files matching **/*.ts', async () => {
    const explorer = new RepoExplorer('/repo');
    const results  = await explorer.searchFiles('**/*.ts');
    const names    = results.map((r) => r.relativePath);
    expect(names).toContain('src/auth.ts');
    expect(names).toContain('src/index.ts');
    expect(names).toContain('src/utils/helpers.ts');
    expect(names).toContain('tests/auth.test.ts');
  });

  it('filters to test files only with tests/**/*.ts', async () => {
    const explorer = new RepoExplorer('/repo');
    const results  = await explorer.searchFiles('tests/**/*.ts');
    const names    = results.map((r) => r.relativePath);
    expect(names).toContain('tests/auth.test.ts');
    expect(names).not.toContain('src/auth.ts');
  });

  it('returns empty array when no files match', async () => {
    const explorer = new RepoExplorer('/repo');
    const results  = await explorer.searchFiles('**/*.go');
    expect(results).toHaveLength(0);
  });

  it('each result has relativePath and absolutePath', async () => {
    const explorer = new RepoExplorer('/repo');
    const results  = await explorer.searchFiles('**/*.json');
    if (results.length > 0) {
      expect(results[0].relativePath).not.toMatch(/^\//);
      expect(results[0].absolutePath).toMatch(/^\//);
    }
  });
});

describe('RepoExplorer.grepCode()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds lines containing "login"', async () => {
    const explorer = new RepoExplorer('/repo');
    const results  = await explorer.grepCode('login');
    expect(results.some((r) => r.file === 'src/auth.ts')).toBe(true);
  });

  it('returns file, line number, and content for each match', async () => {
    const explorer = new RepoExplorer('/repo');
    const results  = await explorer.grepCode('login');
    const match    = results.find((r) => r.file === 'src/auth.ts');
    expect(match).toBeDefined();
    expect(typeof match!.line).toBe('number');
    expect(match!.line).toBeGreaterThan(0);
    expect(typeof match!.content).toBe('string');
  });

  it('returns empty array when pattern matches nothing', async () => {
    const explorer = new RepoExplorer('/repo');
    const results  = await explorer.grepCode('NONEXISTENT_SYMBOL_XYZ');
    expect(results).toHaveLength(0);
  });

  it('accepts regex literal syntax /pattern/flags', async () => {
    const explorer = new RepoExplorer('/repo');
    const results  = await explorer.grepCode('/export\\s+function/i');
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('RepoExplorer.listDirectory()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists root directory entries', async () => {
    const explorer = new RepoExplorer('/repo');
    const entries  = await explorer.listDirectory('.');
    const names    = entries.map((e) => e.name);
    expect(names).toContain('src');
    expect(names).toContain('tests');
    expect(names).toContain('package.json');
  });

  it('directories appear before files', async () => {
    const explorer = new RepoExplorer('/repo');
    const entries  = await explorer.listDirectory('.');
    const firstDir = entries.findIndex((e) => e.type === 'directory');
    const firstFile = entries.findIndex((e) => e.type === 'file');
    if (firstDir !== -1 && firstFile !== -1) {
      expect(firstDir).toBeLessThan(firstFile);
    }
  });

  it('lists src directory', async () => {
    const explorer = new RepoExplorer('/repo');
    const entries  = await explorer.listDirectory('src');
    const names    = entries.map((e) => e.name);
    expect(names).toContain('auth.ts');
    expect(names).toContain('index.ts');
  });

  it('throws for paths that escape the repository root', async () => {
    const explorer = new RepoExplorer('/repo');
    await expect(explorer.listDirectory('../../etc')).rejects.toThrow(/escapes repository root/);
  });

  it('throws for non-existent directories', async () => {
    const explorer = new RepoExplorer('/repo');
    await expect(explorer.listDirectory('nonexistent')).rejects.toThrow();
  });
});
