/**
 * RepoGraphCache — persistent cache for import-graph adjacency edges.
 *
 * Problem: RepoGraph re-reads every source file on every session start.
 * For a large repo this adds seconds of wall-clock time just to rebuild
 * the import graph.
 *
 * Solution:
 *   1. Key each file's adjacency list by sha256(fileContent).
 *   2. On build, check the cache before reading the file at all.
 *   3. After build, flush new/changed entries to disk.
 *
 * Cache file: `.koda/cache/repo-graph.json`
 * Invalidation: content-hash based (same semantics as ASTGraphCache).
 *
 * Usage:
 * ```ts
 * const cache = await RepoGraphCache.load(rootPath);
 * cache.gc();
 * const edges = cache.getEdges(fileHash); // undefined on miss
 * cache.setEdges(fileHash, relPath, edges);
 * await cache.flush();
 * ```
 */

import * as fs     from 'node:fs/promises';
import * as path   from 'node:path';
import * as crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CachedEdgeResult {
  /** sha256 of the file content. */
  hash:     string;
  /** Relative file path (for GC). */
  relPath:  string;
  /** Resolved relative import targets from this file. */
  imports:  string[];
  /** When this entry was cached (Unix ms). */
  cachedAt: number;
}

interface RepoGraphCacheStore {
  version: number;
  entries: Record<string, CachedEdgeResult>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CACHE_VERSION = 1;
const CACHE_FILE    = path.join('.koda', 'cache', 'repo-graph.json');
const MAX_AGE_MS    = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES   = 10_000;

// ── RepoGraphCache ─────────────────────────────────────────────────────────────

export class RepoGraphCache {
  private store: RepoGraphCacheStore;
  private readonly cacheFile: string;
  private dirty = false;

  private constructor(cacheFile: string, store: RepoGraphCacheStore) {
    this.cacheFile = cacheFile;
    this.store     = store;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static async load(rootPath: string): Promise<RepoGraphCache> {
    const cacheFile = path.join(rootPath, CACHE_FILE);
    try {
      const raw   = await fs.readFile(cacheFile, 'utf8');
      const store = JSON.parse(raw) as RepoGraphCacheStore;
      if (store.version !== CACHE_VERSION) {
        return new RepoGraphCache(cacheFile, fresh());
      }
      logger.debug(`[repo-graph-cache] Loaded ${Object.keys(store.entries).length} entries`);
      return new RepoGraphCache(cacheFile, store);
    } catch {
      return new RepoGraphCache(cacheFile, fresh());
    }
  }

  // ── Hash helpers ───────────────────────────────────────────────────────────

  static hashContent(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  static async readAndHash(absPath: string): Promise<[string, string] | null> {
    try {
      const content = await fs.readFile(absPath, 'utf8');
      return [content, RepoGraphCache.hashContent(content)];
    } catch {
      return null;
    }
  }

  // ── Cache operations ───────────────────────────────────────────────────────

  /** Return cached edge list by content hash, or undefined on miss. */
  getEdges(hash: string): CachedEdgeResult | undefined {
    return this.store.entries[hash];
  }

  /** Store the import edges for a file, keyed by its content hash. */
  setEdges(hash: string, relPath: string, imports: string[]): void {
    this.store.entries[hash] = {
      hash,
      relPath,
      imports,
      cachedAt: Date.now(),
    };
    this.dirty = true;
  }

  getStats(): { entries: number } {
    return { entries: Object.keys(this.store.entries).length };
  }

  // ── GC ─────────────────────────────────────────────────────────────────────

  gc(): number {
    const now     = Date.now();
    const entries = Object.entries(this.store.entries);
    const live    = entries.filter(([, v]) => now - v.cachedAt < MAX_AGE_MS);
    live.sort(([, a], [, b]) => b.cachedAt - a.cachedAt);
    const kept    = live.slice(0, MAX_ENTRIES);
    const evicted = entries.length - kept.length;
    if (evicted > 0) {
      this.store.entries = Object.fromEntries(kept);
      this.dirty = true;
      logger.debug(`[repo-graph-cache] GC evicted ${evicted} entries`);
    }
    return evicted;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(this.store), 'utf8');
      this.dirty = false;
      logger.debug(`[repo-graph-cache] Flushed ${Object.keys(this.store.entries).length} entries`);
    } catch (err) {
      logger.warn(`[repo-graph-cache] Flush failed (non-fatal): ${(err as Error).message}`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fresh(): RepoGraphCacheStore {
  return { version: CACHE_VERSION, entries: {} };
}
