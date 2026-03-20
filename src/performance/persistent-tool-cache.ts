/**
 * PersistentToolCache — cross-session disk cache for read-only tool results.
 *
 * Problem: read_file and grep_code are called repeatedly across sessions for
 * unchanged files, consuming both latency and LLM tokens to re-process
 * identical outputs.
 *
 * Solution:
 *   - Cache eligible tool results to `.koda/cache/tool-results.json`.
 *   - Key: sha256(tool + canonicalArgs + fileHash) — changes when file changes.
 *   - Only SAFE (read-only) tools are cached. Write tools are never cached.
 *   - 24-hour TTL (shorter than AST/graph caches since files change more often).
 *
 * Integration:
 * ```ts
 * const ptc = await PersistentToolCache.load(rootPath);
 * const hit = await ptc.get('read_file', { path: 'src/auth.ts' });
 * if (hit) return hit;
 * const result = await runTool(...);
 * await ptc.set('read_file', { path: 'src/auth.ts' }, absPath, result);
 * await ptc.flush();
 * ```
 */

import * as fs     from 'node:fs/promises';
import * as path   from 'node:path';
import * as crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const CACHE_VERSION = 1;
const CACHE_FILE    = path.join('.koda', 'cache', 'tool-results.json');
const MAX_AGE_MS    = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES   = 2_000;

/** Tools whose results are safe to cache across sessions. */
const CACHEABLE_TOOLS = new Set([
  'read_file',
  'grep_code',
  'search_code',
  'list_files',
  'git_log',
  'git_diff',
]);

// ── Types ──────────────────────────────────────────────────────────────────────

interface CachedToolEntry {
  /** Cache key: sha256 of tool+args+content hash. */
  key:      string;
  /** Tool name. */
  tool:     string;
  /** Tool result output. */
  output:   string;
  /** Unix ms of storage. */
  cachedAt: number;
}

interface PersistentToolCacheStore {
  version: number;
  entries: Record<string, CachedToolEntry>;
}

// ── PersistentToolCache ────────────────────────────────────────────────────────

export class PersistentToolCache {
  private store: PersistentToolCacheStore;
  private readonly cacheFile: string;
  private dirty = false;
  private hits  = 0;
  private misses = 0;

  private constructor(cacheFile: string, store: PersistentToolCacheStore) {
    this.cacheFile = cacheFile;
    this.store     = store;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static async load(rootPath: string): Promise<PersistentToolCache> {
    const cacheFile = path.join(rootPath, CACHE_FILE);
    try {
      const raw   = await fs.readFile(cacheFile, 'utf8');
      const store = JSON.parse(raw) as PersistentToolCacheStore;
      if (store.version !== CACHE_VERSION) {
        return new PersistentToolCache(cacheFile, fresh());
      }
      logger.debug(`[persistent-tool-cache] Loaded ${Object.keys(store.entries).length} entries`);
      return new PersistentToolCache(cacheFile, store);
    } catch {
      return new PersistentToolCache(cacheFile, fresh());
    }
  }

  // ── Cache operations ───────────────────────────────────────────────────────

  /**
   * Look up a cached tool result.
   * Returns the cached output or undefined on miss.
   *
   * @param tool     - Tool name.
   * @param args     - Tool arguments.
   * @param absPath  - If provided, the file is re-hashed to detect content changes.
   *                   If the file changed, the cache entry is invalidated.
   */
  async get(
    tool:    string,
    args:    Record<string, string>,
    absPath?: string,
  ): Promise<string | undefined> {
    if (!CACHEABLE_TOOLS.has(tool)) return undefined;

    const key   = await this._buildKey(tool, args, absPath);
    const entry = this.store.entries[key];

    if (!entry) { this.misses++; return undefined; }
    if (Date.now() - entry.cachedAt > MAX_AGE_MS) {
      delete this.store.entries[key];
      this.dirty = true;
      this.misses++;
      return undefined;
    }

    this.hits++;
    logger.debug(`[persistent-tool-cache] Hit: ${tool} (${key.slice(0, 12)}…)`);
    return entry.output;
  }

  /**
   * Store a tool result.
   *
   * @param tool    - Tool name.
   * @param args    - Tool arguments.
   * @param absPath - Optional: file path used to compute content hash.
   * @param output  - Tool output to cache.
   */
  async set(
    tool:    string,
    args:    Record<string, string>,
    absPath: string | undefined,
    output:  string,
  ): Promise<void> {
    if (!CACHEABLE_TOOLS.has(tool)) return;
    const key = await this._buildKey(tool, args, absPath);
    this.store.entries[key] = { key, tool, output, cachedAt: Date.now() };
    this.dirty = true;

    // Evict if over cap (drop oldest)
    const entries = Object.entries(this.store.entries);
    if (entries.length > MAX_ENTRIES) {
      entries.sort(([, a], [, b]) => a.cachedAt - b.cachedAt);
      const toEvict = entries.slice(0, entries.length - MAX_ENTRIES);
      for (const [k] of toEvict) delete this.store.entries[k];
    }
  }

  getStats(): { entries: number; hits: number; misses: number; hitRate: string } {
    const total   = this.hits + this.misses;
    const hitRate = total > 0 ? `${Math.round((this.hits / total) * 100)}%` : 'n/a';
    return { entries: Object.keys(this.store.entries).length, hits: this.hits, misses: this.misses, hitRate };
  }

  /** Evict entries older than MAX_AGE_MS. */
  gc(): number {
    const now     = Date.now();
    const entries = Object.entries(this.store.entries);
    const live    = entries.filter(([, v]) => now - v.cachedAt < MAX_AGE_MS);
    const evicted = entries.length - live.length;
    if (evicted > 0) {
      this.store.entries = Object.fromEntries(live);
      this.dirty = true;
      logger.debug(`[persistent-tool-cache] GC evicted ${evicted} entries`);
    }
    return evicted;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(this.store), 'utf8');
      this.dirty = false;
      logger.debug(`[persistent-tool-cache] Flushed ${Object.keys(this.store.entries).length} entries`);
    } catch (err) {
      logger.warn(`[persistent-tool-cache] Flush failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _buildKey(
    tool:    string,
    args:    Record<string, string>,
    absPath?: string,
  ): Promise<string> {
    const canonical = JSON.stringify(
      Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b))),
    );
    let fileHash = '';
    if (absPath) {
      try {
        const content = await fs.readFile(absPath, 'utf8');
        fileHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
      } catch {
        fileHash = 'unreadable';
      }
    }
    const raw = `${tool}:${canonical}:${fileHash}`;
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fresh(): PersistentToolCacheStore {
  return { version: CACHE_VERSION, entries: {} };
}
