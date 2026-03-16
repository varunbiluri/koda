/**
 * Tests for RepoIntelligenceCache.
 *
 * All filesystem and child_process operations are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepoIntelligenceCache } from '../../src/cache/repo-intelligence-cache.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  readFile:  vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir:     vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RepoIntelligenceCache', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for an empty cache', async () => {
    const cache = await RepoIntelligenceCache.load('/repo');
    expect(await cache.getArchitectureSummary()).toBeNull();
    expect(await cache.getDependencyGraph()).toBeNull();
    expect(await cache.getImportantFiles()).toBeNull();
    expect(await cache.getApiRoutes()).toBeNull();
  });

  it('stores and retrieves architecture summary', async () => {
    const cache = await RepoIntelligenceCache.load('/repo');
    await cache.setArchitectureSummary('## Architecture\nEntry: src/index.ts');
    const result = await cache.getArchitectureSummary();
    expect(result).toBe('## Architecture\nEntry: src/index.ts');
  });

  it('stores and retrieves dependency graph', async () => {
    const cache = await RepoIntelligenceCache.load('/repo');
    await cache.setDependencyGraph({ 'src/auth.ts': ['src/utils.ts'] });
    const result = await cache.getDependencyGraph();
    expect(result).toEqual({ 'src/auth.ts': ['src/utils.ts'] });
  });

  it('stores and retrieves important files', async () => {
    const cache = await RepoIntelligenceCache.load('/repo');
    await cache.setImportantFiles(['src/index.ts', 'src/auth.ts']);
    const result = await cache.getImportantFiles();
    expect(result).toEqual(['src/index.ts', 'src/auth.ts']);
  });

  it('stores and retrieves API routes', async () => {
    const cache = await RepoIntelligenceCache.load('/repo');
    await cache.setApiRoutes(['/api/auth', '/api/users']);
    const result = await cache.getApiRoutes();
    expect(result).toEqual(['/api/auth', '/api/users']);
  });

  it('invalidate() clears all entries', async () => {
    const cache = await RepoIntelligenceCache.load('/repo');
    await cache.setArchitectureSummary('summary');
    await cache.setImportantFiles(['a.ts']);
    cache.invalidate();
    expect(await cache.getArchitectureSummary()).toBeNull();
    expect(await cache.getImportantFiles()).toBeNull();
  });

  it('invalidateKey() removes only the specified entry', async () => {
    const cache = await RepoIntelligenceCache.load('/repo');
    await cache.setArchitectureSummary('summary');
    await cache.setImportantFiles(['a.ts']);
    cache.invalidateKey('architectureSummary');
    expect(await cache.getArchitectureSummary()).toBeNull();
    expect(await cache.getImportantFiles()).toEqual(['a.ts']);
  });

  it('save() calls fs.writeFile', async () => {
    const { writeFile } = await import('node:fs/promises');
    const cache = await RepoIntelligenceCache.load('/repo');
    await cache.setArchitectureSummary('data');
    await cache.save();
    expect(writeFile).toHaveBeenCalledOnce();
  });

  it('TTL expiry: expired entry returns null', async () => {
    // Use a very short TTL of 1ms
    const cache = await RepoIntelligenceCache.load('/repo', 1);
    await cache.setArchitectureSummary('old data');
    // Wait 5ms to ensure TTL has passed
    await new Promise((r) => setTimeout(r, 5));
    const result = await cache.getArchitectureSummary();
    expect(result).toBeNull();
  });

  it('TTL not yet expired: returns cached value', async () => {
    const cache = await RepoIntelligenceCache.load('/repo', 60_000);
    await cache.setArchitectureSummary('fresh data');
    expect(await cache.getArchitectureSummary()).toBe('fresh data');
  });
});
