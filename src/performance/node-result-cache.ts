/**
 * NodeResultCache — skip re-executing unchanged graph nodes across sessions.
 *
 * Problem: When re-running the same or similar task (e.g. after a small file
 * change), many nodes in the execution graph produce identical results.
 * Re-executing them wastes LLM tokens, time, and money.
 *
 * Solution:
 *   - After a node completes, hash(nodeDescription + toolInputs + fileContents)
 *     and store its output keyed by that hash.
 *   - On next run, if the hash matches, skip the node and replay the cached output.
 *   - Stored at `.koda/cache/node-results.json` with a 48-hour TTL.
 *
 * Cache invalidation:
 *   - Any change to a file referenced by the node invalidates it (content hash).
 *   - Task description changes invalidate the node (different node hash).
 *   - Retries always bypass the cache (we do NOT cache failed nodes).
 *
 * Usage:
 * ```ts
 * const nrc = await NodeResultCache.load(rootPath);
 * const key = await NodeResultCache.buildKey(nodeDesc, toolArgs, filePaths);
 * const hit = nrc.get(key);
 * if (hit) return hit.output;
 * // ... execute node ...
 * nrc.set(key, nodeDesc, output);
 * await nrc.flush();
 * ```
 */

import * as fs     from 'node:fs/promises';
import * as path   from 'node:path';
import * as crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const CACHE_VERSION = 1;
const CACHE_FILE    = path.join('.koda', 'cache', 'node-results.json');
const MAX_AGE_MS    = 48 * 60 * 60 * 1000; // 48 hours
const MAX_ENTRIES   = 500;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CachedNodeResult {
  /** Cache key (hash of node inputs). */
  key:         string;
  /** Node description / task label for debugging. */
  nodeDesc:    string;
  /** LLM output / tool execution result. */
  output:      string;
  /** Whether the node completed successfully. */
  success:     boolean;
  /** Unix ms of storage. */
  cachedAt:    number;
}

interface NodeResultCacheStore {
  version: number;
  entries: Record<string, CachedNodeResult>;
}

// ── NodeResultCache ────────────────────────────────────────────────────────────

export class NodeResultCache {
  private store: NodeResultCacheStore;
  private readonly cacheFile: string;
  private dirty  = false;
  private hits   = 0;
  private misses = 0;

  private constructor(cacheFile: string, store: NodeResultCacheStore) {
    this.cacheFile = cacheFile;
    this.store     = store;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static async load(rootPath: string): Promise<NodeResultCache> {
    const cacheFile = path.join(rootPath, CACHE_FILE);
    try {
      const raw   = await fs.readFile(cacheFile, 'utf8');
      const store = JSON.parse(raw) as NodeResultCacheStore;
      if (store.version !== CACHE_VERSION) {
        return new NodeResultCache(cacheFile, fresh());
      }
      logger.debug(`[node-result-cache] Loaded ${Object.keys(store.entries).length} entries`);
      return new NodeResultCache(cacheFile, store);
    } catch {
      return new NodeResultCache(cacheFile, fresh());
    }
  }

  // ── Key building ───────────────────────────────────────────────────────────

  /**
   * Build a stable cache key from:
   *   - nodeDescription: the task/node label
   *   - toolArgs: JSON-serialised tool calls made during planning
   *   - filePaths: absolute paths to files that were read (content-hashed)
   */
  static async buildKey(
    nodeDescription: string,
    toolArgs:        Record<string, unknown>,
    filePaths:       string[],
  ): Promise<string> {
    const h = crypto.createHash('sha256');
    h.update(nodeDescription, 'utf8');
    h.update(JSON.stringify(toolArgs), 'utf8');

    // Hash actual file contents (order-independent)
    const sorted = [...filePaths].sort();
    for (const fp of sorted) {
      try {
        const content = await fs.readFile(fp, 'utf8');
        h.update(fp + ':' + crypto.createHash('sha256').update(content, 'utf8').digest('hex'), 'utf8');
      } catch {
        h.update(fp + ':MISSING', 'utf8');
      }
    }

    return h.digest('hex');
  }

  // ── Cache operations ───────────────────────────────────────────────────────

  /** Return a cached node result, or undefined on miss/stale. */
  get(key: string): CachedNodeResult | undefined {
    const entry = this.store.entries[key];
    if (!entry) { this.misses++; return undefined; }
    if (Date.now() - entry.cachedAt > MAX_AGE_MS) {
      delete this.store.entries[key];
      this.dirty = true;
      this.misses++;
      return undefined;
    }
    this.hits++;
    logger.debug(`[node-result-cache] Hit: ${entry.nodeDesc.slice(0, 60)}`);
    return entry;
  }

  /** Store a successfully completed node's output. Only caches successes. */
  set(key: string, nodeDesc: string, output: string): void {
    this.store.entries[key] = {
      key,
      nodeDesc,
      output,
      success:  true,
      cachedAt: Date.now(),
    };
    this.dirty = true;

    // Evict oldest if over cap
    const entries = Object.entries(this.store.entries);
    if (entries.length > MAX_ENTRIES) {
      entries.sort(([, a], [, b]) => a.cachedAt - b.cachedAt);
      for (const [k] of entries.slice(0, entries.length - MAX_ENTRIES)) {
        delete this.store.entries[k];
      }
    }
  }

  getStats(): { entries: number; hits: number; misses: number; hitRate: string } {
    const total   = this.hits + this.misses;
    const hitRate = total > 0 ? `${Math.round((this.hits / total) * 100)}%` : 'n/a';
    return { entries: Object.keys(this.store.entries).length, hits: this.hits, misses: this.misses, hitRate };
  }

  gc(): number {
    const now     = Date.now();
    const entries = Object.entries(this.store.entries);
    const live    = entries.filter(([, v]) => now - v.cachedAt < MAX_AGE_MS);
    const evicted = entries.length - live.length;
    if (evicted > 0) {
      this.store.entries = Object.fromEntries(live);
      this.dirty = true;
      logger.debug(`[node-result-cache] GC evicted ${evicted} entries`);
    }
    return evicted;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(this.store), 'utf8');
      this.dirty = false;
      logger.debug(`[node-result-cache] Flushed ${Object.keys(this.store.entries).length} entries`);
    } catch (err) {
      logger.warn(`[node-result-cache] Flush failed (non-fatal): ${(err as Error).message}`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fresh(): NodeResultCacheStore {
  return { version: CACHE_VERSION, entries: {} };
}
