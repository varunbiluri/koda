/**
 * RepoIntelligenceCache — caches expensive repository analysis results.
 *
 * Cached data:
 *   - Architecture summary (from ArchitectureAnalyzer)
 *   - Dependency graph
 *   - Important files
 *   - API routes
 *
 * Invalidation triggers:
 *   - TTL expiry (default 1 hour)
 *   - Git commit hash change (detected via `git rev-parse HEAD`)
 *   - Explicit invalidate() call
 *
 * Persistence: stores cache as `.koda/intelligence-cache.json` alongside the index.
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  value:      T;
  timestamp:  number;   // Unix ms
  gitCommit?: string;   // HEAD commit hash at time of cache
}

export interface CachedRepoIntelligence {
  architectureSummary?: CacheEntry<string>;
  dependencyGraph?:     CacheEntry<Record<string, string[]>>;
  importantFiles?:      CacheEntry<string[]>;
  apiRoutes?:           CacheEntry<string[]>;
  /**
   * Serialised RepositoryContext from RepositoryExplorer.
   * Shorter TTL (10 minutes) — keyed by repoRoot + commitHash.
   */
  explorerContext?:     CacheEntry<string>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CACHE_FILE    = '.koda/intelligence-cache.json';
const DEFAULT_TTL   = 60 * 60 * 1000;  // 1 hour in ms
const EXPLORER_TTL  = 10 * 60 * 1000;  // 10 minutes for explorer context

// ── RepoIntelligenceCache ─────────────────────────────────────────────────────

/**
 * Thread-safe in-memory cache with optional disk persistence.
 *
 * Usage:
 * ```ts
 * const cache = await RepoIntelligenceCache.load('/repo');
 * const cached = cache.getArchitectureSummary();
 * if (!cached) {
 *   const summary = await analyzeArchitecture(...);
 *   cache.setArchitectureSummary(summary);
 *   await cache.save();
 * }
 * ```
 */
export class RepoIntelligenceCache {
  private data: CachedRepoIntelligence = {};
  private readonly ttlMs: number;

  private constructor(
    private readonly rootPath: string,
    ttlMs = DEFAULT_TTL,
  ) {
    this.ttlMs = ttlMs;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  /** Load an existing cache from disk, or create a fresh instance. */
  static async load(rootPath: string, ttlMs = DEFAULT_TTL): Promise<RepoIntelligenceCache> {
    const cache = new RepoIntelligenceCache(rootPath, ttlMs);
    const cachePath = path.join(rootPath, CACHE_FILE);
    try {
      const raw = await fs.readFile(cachePath, 'utf-8');
      cache.data = JSON.parse(raw) as CachedRepoIntelligence;
      logger.debug('[repo-cache] Loaded cache from disk');
    } catch {
      logger.debug('[repo-cache] No cache file found — starting fresh');
    }
    return cache;
  }

  // ── Read API ───────────────────────────────────────────────────────────────

  /**
   * Return the cached architecture summary if it's still valid.
   * Returns null if missing, expired, or stale relative to the current HEAD.
   */
  async getArchitectureSummary(): Promise<string | null> {
    return this._get('architectureSummary') as Promise<string | null>;
  }

  async getDependencyGraph(): Promise<Record<string, string[]> | null> {
    return this._get('dependencyGraph') as Promise<Record<string, string[]> | null>;
  }

  async getImportantFiles(): Promise<string[] | null> {
    return this._get('importantFiles') as Promise<string[] | null>;
  }

  async getApiRoutes(): Promise<string[] | null> {
    return this._get('apiRoutes') as Promise<string[] | null>;
  }

  // ── Write API ──────────────────────────────────────────────────────────────

  async setArchitectureSummary(value: string): Promise<void> {
    await this._set('architectureSummary', value);
  }

  async setDependencyGraph(value: Record<string, string[]>): Promise<void> {
    await this._set('dependencyGraph', value);
  }

  async setImportantFiles(value: string[]): Promise<void> {
    await this._set('importantFiles', value);
  }

  async setApiRoutes(value: string[]): Promise<void> {
    await this._set('apiRoutes', value);
  }

  /**
   * Return the cached explorer context summary (JSON string) if valid.
   * Uses EXPLORER_TTL (10 minutes) instead of the instance TTL.
   */
  async getExplorerContext(): Promise<string | null> {
    return this._get('explorerContext', EXPLORER_TTL) as Promise<string | null>;
  }

  async setExplorerContext(value: string): Promise<void> {
    await this._set('explorerContext', value);
  }

  // ── Invalidation ──────────────────────────────────────────────────────────

  /** Remove all cached entries. */
  invalidate(): void {
    this.data = {};
    logger.debug('[repo-cache] Cache invalidated');
  }

  /** Remove a specific cached entry by key. */
  invalidateKey(key: keyof CachedRepoIntelligence): void {
    delete this.data[key];
    logger.debug(`[repo-cache] Invalidated key: ${key}`);
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /** Flush the in-memory cache to disk. Non-fatal on error. */
  async save(): Promise<void> {
    try {
      const dir = path.join(this.rootPath, '.koda');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(this.rootPath, CACHE_FILE),
        JSON.stringify(this.data, null, 2),
        'utf-8',
      );
      logger.debug('[repo-cache] Cache saved to disk');
    } catch (err) {
      logger.warn(`[repo-cache] Save failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _get(key: keyof CachedRepoIntelligence, ttlOverride?: number): Promise<unknown> {
    const entry = this.data[key] as CacheEntry<unknown> | undefined;
    if (!entry) return null;

    // TTL check (use override TTL if provided, e.g. for explorer context)
    const effectiveTtl = ttlOverride ?? this.ttlMs;
    if (Date.now() - entry.timestamp > effectiveTtl) {
      logger.debug(`[repo-cache] TTL expired for key: ${key}`);
      delete this.data[key];
      return null;
    }

    // Git commit check (non-fatal — skip if git not available)
    if (entry.gitCommit) {
      const currentCommit = await this._currentGitCommit();
      if (currentCommit && currentCommit !== entry.gitCommit) {
        logger.debug(`[repo-cache] Git commit changed — invalidating ${key}`);
        delete this.data[key];
        return null;
      }
    }

    return entry.value;
  }

  private async _set(key: keyof CachedRepoIntelligence, value: unknown): Promise<void> {
    const gitCommit = await this._currentGitCommit();
    (this.data as Record<string, CacheEntry<unknown>>)[key] = {
      value,
      timestamp: Date.now(),
      ...(gitCommit ? { gitCommit } : {}),
    };
  }

  /** Read the current HEAD commit hash. Returns null if git is unavailable. */
  private async _currentGitCommit(): Promise<string | null> {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const exec = promisify(execFile);
      const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: this.rootPath });
      return stdout.trim();
    } catch {
      return null;
    }
  }
}

/** Module-level cache instances keyed by rootPath for reuse within a session. */
const _instances = new Map<string, RepoIntelligenceCache>();

/**
 * Get or create a RepoIntelligenceCache for the given rootPath.
 * Re-uses an existing instance within the same process session.
 */
export async function getRepoIntelligenceCache(rootPath: string): Promise<RepoIntelligenceCache> {
  if (!_instances.has(rootPath)) {
    _instances.set(rootPath, await RepoIntelligenceCache.load(rootPath));
  }
  return _instances.get(rootPath)!;
}
