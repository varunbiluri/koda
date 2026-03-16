/**
 * Tests for RepositoryExplorer.
 *
 * The filesystem is mocked via vi.mock so no real disk I/O happens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepositoryExplorer } from '../../src/agents/repository-explorer.js';
import type { Dirent } from 'node:fs';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Build a realistic fake directory tree
const FAKE_FILES: Record<string, Array<{ name: string; isDir: boolean }>> = {
  '/repo': [
    { name: 'src',           isDir: true  },
    { name: 'tests',         isDir: true  },
    { name: 'tsconfig.json', isDir: false },
    { name: 'package.json',  isDir: false },
  ],
  '/repo/src': [
    { name: 'index.ts',      isDir: false },
    { name: 'cli.ts',        isDir: false },
    { name: 'auth',          isDir: true  },
    { name: 'routes',        isDir: true  },
    { name: 'models',        isDir: true  },
  ],
  '/repo/src/auth': [
    { name: 'auth-service.ts',  isDir: false },
    { name: 'jwt-handler.ts',   isDir: false },
    { name: 'middleware.ts',    isDir: false },
    { name: 'auth-types.ts',    isDir: false },
  ],
  '/repo/src/routes': [
    { name: 'auth.route.ts',    isDir: false },
    { name: 'users.route.ts',   isDir: false },
    { name: 'health.route.ts',  isDir: false },
  ],
  '/repo/src/models': [
    { name: 'user.model.ts',    isDir: false },
    { name: 'session.model.ts', isDir: false },
  ],
  '/repo/tests': [
    { name: 'auth.test.ts',     isDir: false },
    { name: 'routes.test.ts',   isDir: false },
  ],
};

function makeDirent(name: string, isDirectory: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  } as unknown as Dirent;
}

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(async (dir: string) => {
    const entries = FAKE_FILES[dir] ?? [];
    return entries.map((e) => makeDirent(e.name, e.isDir));
  }),
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RepositoryExplorer.explore()', () => {
  let explorer: RepositoryExplorer;

  beforeEach(() => {
    explorer = new RepositoryExplorer('/repo');
  });

  it('detects entry points (index.ts, cli.ts)', async () => {
    const ctx = await explorer.explore();
    expect(ctx.entryPoints.some((f) => f.includes('index.ts'))).toBe(true);
    expect(ctx.entryPoints.some((f) => f.includes('cli.ts'))).toBe(true);
  });

  it('detects key modules with ≥3 source files', async () => {
    const ctx = await explorer.explore();
    // src/auth has 4 files — should be a key module
    expect(ctx.keyModules.some((m) => m.includes('auth'))).toBe(true);
  });

  it('detects API routes files', async () => {
    const ctx = await explorer.explore();
    expect(ctx.apiRoutes.length).toBeGreaterThan(0);
    expect(ctx.apiRoutes.every((f) => f.endsWith('.ts'))).toBe(true);
  });

  it('detects database / model files', async () => {
    const ctx = await explorer.explore();
    expect(ctx.databaseFiles.length).toBeGreaterThan(0);
    expect(ctx.databaseFiles.some((f) => f.includes('model'))).toBe(true);
  });

  it('detects test files', async () => {
    const ctx = await explorer.explore();
    expect(ctx.testFiles.length).toBeGreaterThan(0);
    expect(ctx.testFiles.every((f) => f.includes('.test.'))).toBe(true);
  });

  it('detects config files', async () => {
    const ctx = await explorer.explore();
    expect(ctx.configFiles.some((f) => f.includes('tsconfig.json'))).toBe(true);
    expect(ctx.configFiles.some((f) => f.includes('package.json'))).toBe(true);
  });

  it('builds a non-empty summary string', async () => {
    const ctx = await explorer.explore();
    expect(ctx.summary).toBeTruthy();
    expect(ctx.summary).toContain('Repository Structure');
  });

  it('caps entryPoints at 5', async () => {
    const ctx = await explorer.explore();
    expect(ctx.entryPoints.length).toBeLessThanOrEqual(5);
  });

  it('returns relative paths (not absolute)', async () => {
    const ctx = await explorer.explore();
    for (const f of [...ctx.entryPoints, ...ctx.testFiles, ...ctx.configFiles]) {
      expect(f.startsWith('/')).toBe(false);
    }
  });

  it('returns a summary mentioning key modules', async () => {
    const ctx = await explorer.explore();
    // Summary should contain at least one module path
    const hasModule = ctx.keyModules.some((m) => ctx.summary.includes(m));
    expect(hasModule).toBe(true);
  });
});
