/**
 * ASTGraphCache — file-hash-keyed persistent cache for AST parse results.
 *
 * Problem solved: ASTRepoGraph re-parses every source file on every session start.
 * For a 2 000-file repo this can take several seconds and is pure waste when
 * files haven't changed.
 *
 * Solution:
 *   1. Before parsing a file, compute sha256(content).
 *   2. Look up the hash in the cache.  If present → return stored result.
 *   3. After a successful parse, store (hash → result) in the cache.
 *   4. Flush to `.koda/cache/ast-graph.json` at the end of the build pass.
 *
 * Cache invalidation: content-hash-based (not mtime).  A file that reverts to
 * a previous state will re-use the older cache entry — this is correct behaviour.
 *
 * Cross-session: the cache is written to disk and loaded on the next run.
 * Only entries whose file paths still exist in the workspace are kept.
 *
 * Usage:
 * ```ts
 * const cache = await ASTGraphCache.load(rootPath);
 * const hit   = cache.get(fileHash);
 * if (!hit) {
 *   const result = await parseFile(filePath);
 *   cache.set(fileHash, filePath, result);
 * }
 * await cache.flush();
 * ```
 */

import * as fs     from 'node:fs/promises';
import * as path   from 'node:path';
import * as crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CachedFileResult {
  /** sha256 hex digest of the file content at cache time. */
  hash:         string;
  /** Relative path from rootPath, for GC (file-still-exists check). */
  relPath:      string;
  /** Extracted import specifiers (relative only, normalised). */
  imports:      string[];
  /** Symbol names and kinds (compact form for graph nodes). */
  symbols:      Array<{ name: string; kind: string; startLine: number; endLine: number }>;
  /** Unix ms timestamp when this entry was written. */
  cachedAt:     number;
}

interface ASTGraphCacheStore {
  version: number;
  /** Map from sha256 hash → parse result. */
  entries: Record<string, CachedFileResult>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CACHE_VERSION = 1;
const CACHE_FILE    = path.join('.koda', 'cache', 'ast-graph.json');
/** Entries older than this are evicted even if content hasn't changed. */
const MAX_AGE_MS    = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Maximum number of entries to retain. */
const MAX_ENTRIES   = 5_000;

// ── ASTGraphCache ──────────────────────────────────────────────────────────────

export class ASTGraphCache {
  private store: ASTGraphCacheStore;
  private readonly cacheFile: string;
  private dirty = false;

  private constructor(cacheFile: string, store: ASTGraphCacheStore) {
    this.cacheFile = cacheFile;
    this.store     = store;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static async load(rootPath: string): Promise<ASTGraphCache> {
    const cacheFile = path.join(rootPath, CACHE_FILE);
    try {
      const raw   = await fs.readFile(cacheFile, 'utf8');
      const store = JSON.parse(raw) as ASTGraphCacheStore;
      if (store.version !== CACHE_VERSION) {
        return new ASTGraphCache(cacheFile, fresh());
      }
      logger.debug(`[ast-graph-cache] Loaded ${Object.keys(store.entries).length} entries`);
      return new ASTGraphCache(cacheFile, store);
    } catch {
      return new ASTGraphCache(cacheFile, fresh());
    }
  }

  // ── Hash helpers ───────────────────────────────────────────────────────────

  /** Compute the sha256 hash of a file's content string. */
  static hashContent(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /** Read a file and return [content, hash]. Returns null if unreadable. */
  static async readAndHash(absPath: string): Promise<[string, string] | null> {
    try {
      const content = await fs.readFile(absPath, 'utf8');
      return [content, ASTGraphCache.hashContent(content)];
    } catch {
      return null;
    }
  }

  // ── Cache operations ───────────────────────────────────────────────────────

  /** Return a cached result by content hash, or undefined on miss. */
  get(hash: string): CachedFileResult | undefined {
    return this.store.entries[hash];
  }

  /** Store a parse result keyed by content hash. */
  set(hash: string, relPath: string, result: Omit<CachedFileResult, 'hash' | 'relPath' | 'cachedAt'>): void {
    this.store.entries[hash] = {
      hash,
      relPath,
      cachedAt: Date.now(),
      ...result,
    };
    this.dirty = true;
  }

  /** Return cache stats: total entries, estimated byte size. */
  getStats(): { entries: number; hitRate?: number } {
    return { entries: Object.keys(this.store.entries).length };
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  /**
   * Remove stale entries: older than MAX_AGE_MS, or over the MAX_ENTRIES cap.
   * Call this once per session after loading.
   */
  gc(): number {
    const now     = Date.now();
    const entries = Object.entries(this.store.entries);

    // Evict by age
    const live = entries.filter(([, v]) => now - v.cachedAt < MAX_AGE_MS);

    // Evict oldest if over cap
    live.sort(([, a], [, b]) => b.cachedAt - a.cachedAt); // newest first
    const kept = live.slice(0, MAX_ENTRIES);

    const evicted = entries.length - kept.length;
    if (evicted > 0) {
      this.store.entries = Object.fromEntries(kept);
      this.dirty = true;
      logger.debug(`[ast-graph-cache] GC evicted ${evicted} stale entries`);
    }
    return evicted;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /**
   * Flush the cache to disk if any entries were added or removed.
   * Non-fatal — a write failure doesn't break the session.
   */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(this.store), 'utf8');
      this.dirty = false;
      logger.debug(`[ast-graph-cache] Flushed ${Object.keys(this.store.entries).length} entries`);
    } catch (err) {
      logger.warn(`[ast-graph-cache] Flush failed (non-fatal): ${(err as Error).message}`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fresh(): ASTGraphCacheStore {
  return { version: CACHE_VERSION, entries: {} };
}
