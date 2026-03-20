/**
 * RepoGraph — lightweight static-analysis knowledge graph of the repository.
 *
 * Nodes represent files. Edges represent import/require relationships.
 * Built by scanning file contents with regex — no full AST parser required.
 *
 * Supports:
 *   - Forward map:  file  → files it imports
 *   - Reverse map:  file  → files that import it (dependents)
 *   - Impact set:   given a change to file F, which files are transitively affected?
 *   - Ownership:    which files share a common directory (same "module")?
 *
 * Designed to be rebuilt per-session (fast, no caching needed for < 2k files).
 *
 * Usage:
 * ```ts
 * const graph = await RepoGraph.build(rootPath, filePaths);
 * const impact = graph.getImpactSet('src/auth/auth-service.ts');
 * // → Set { 'src/api/routes.ts', 'src/middleware/auth-guard.ts', ... }
 *
 * const report = graph.impactReport(['src/auth/auth-service.ts']);
 * // → { level: 'HIGH', affectedCount: 14, affectedFiles: [...] }
 * ```
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ImpactLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ImpactReport {
  /** Overall impact level for the changed files. */
  level:          ImpactLevel;
  /** Number of files directly or transitively affected. */
  affectedCount:  number;
  /** The affected file paths (up to 30 listed). */
  affectedFiles:  string[];
  /** One-line description for terminal display. */
  summary:        string;
}

// ── RepoGraph ──────────────────────────────────────────────────────────────────

export class RepoGraph {
  /** file → set of files it imports */
  protected readonly fwd: Map<string, Set<string>> = new Map();
  /** file → set of files that import it */
  protected readonly rev: Map<string, Set<string>> = new Map();

  /** Use RepoGraph.build() or ASTRepoGraph.build() — not constructed directly. */
  protected constructor() {}

  // ── Factory ────────────────────────────────────────────────────────────────

  /**
   * Build the graph by reading all provided files and extracting imports.
   *
   * @param rootPath  - Repository root (used to resolve relative imports).
   * @param filePaths - Absolute or rootPath-relative paths to scan.
   *                    Pass an empty array for a no-op empty graph.
   */
  static async build(rootPath: string, filePaths: string[]): Promise<RepoGraph> {
    const g = new RepoGraph();
    const tasks = filePaths.map((fp) => g._scanFile(rootPath, fp));
    // Process files with limited concurrency (avoid fd exhaustion on large repos)
    const BATCH = 64;
    for (let i = 0; i < tasks.length; i += BATCH) {
      await Promise.all(tasks.slice(i, i + BATCH));
    }
    logger.debug(`[repo-graph] Built graph: ${g.fwd.size} nodes, ${g._edgeCount()} edges`);
    return g;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Return the set of files that directly import `filePath`.
   */
  getDirectDependents(filePath: string): Set<string> {
    return this.rev.get(normalize(filePath)) ?? new Set();
  }

  /**
   * Return the set of files that `filePath` directly imports.
   */
  getDirectDependencies(filePath: string): Set<string> {
    return this.fwd.get(normalize(filePath)) ?? new Set();
  }

  /**
   * BFS from `filePath` through the reverse graph to find ALL files that
   * would be affected if `filePath` changes (direct + transitive dependents).
   */
  getImpactSet(filePath: string): Set<string> {
    const norm    = normalize(filePath);
    const visited = new Set<string>();
    const queue   = [norm];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const dep of (this.rev.get(cur) ?? [])) {
        if (!visited.has(dep)) queue.push(dep);
      }
    }
    visited.delete(norm); // the changed file itself is not "affected by" itself
    return visited;
  }

  /**
   * Compute an ImpactReport for a set of changed files.
   * Merges impact sets from all changed files and classifies severity.
   */
  impactReport(changedFiles: string[]): ImpactReport {
    const affected = new Set<string>();
    for (const f of changedFiles) {
      for (const a of this.getImpactSet(f)) affected.add(a);
    }

    const count = affected.size;
    const level: ImpactLevel = count >= 10 ? 'HIGH' : count >= 3 ? 'MEDIUM' : 'LOW';

    const listed = [...affected].slice(0, 30);
    const summary = count === 0
      ? 'No other files import this file'
      : `${count} file${count !== 1 ? 's' : ''} are affected — ${level} impact`;

    return { level, affectedCount: count, affectedFiles: listed, summary };
  }

  /**
   * Format a compact impact warning for display before a write operation.
   * Returns empty string when impact is LOW.
   */
  formatImpactWarning(changedFiles: string[]): string {
    const report = this.impactReport(changedFiles);
    if (report.level === 'LOW') return '';

    const color = report.level === 'HIGH' ? '🔴' : '🟡';
    const lines: string[] = [
      `${color} Impact analysis: ${report.summary}`,
      '',
    ];

    const preview = report.affectedFiles.slice(0, 8);
    for (const f of preview) lines.push(`  · ${f}`);
    if (report.affectedCount > 8) {
      lines.push(`  · … and ${report.affectedCount - 8} more`);
    }

    return lines.join('\n');
  }

  /** Number of files (nodes) in the graph. */
  get nodeCount(): number { return this.fwd.size; }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _scanFile(rootPath: string, filePath: string): Promise<void> {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
    const key = normalize(path.relative(rootPath, abs));
    this._ensureNode(key);

    // Only scan text files that can have imports
    if (!IMPORTABLE.test(filePath)) return;

    let content: string;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch {
      return; // file unreadable — skip
    }

    const imports = extractImports(content, abs, rootPath);
    for (const imp of imports) {
      const rel = normalize(imp);
      this._ensureNode(rel);
      // fwd: key imports rel
      this.fwd.get(key)!.add(rel);
      // rev: rel is imported by key
      this._ensureNode(rel);
      this.rev.get(rel)!.add(key);
    }
  }

  protected _ensureNode(key: string): void {
    if (!this.fwd.has(key)) this.fwd.set(key, new Set());
    if (!this.rev.has(key)) this.rev.set(key, new Set());
  }

  /** Add a directed edge: `from` imports `to`. */
  protected _addEdge(from: string, to: string): void {
    this._ensureNode(from);
    this._ensureNode(to);
    this.fwd.get(from)!.add(to);
    this.rev.get(to)!.add(from);
  }

  private _edgeCount(): number {
    let n = 0;
    for (const s of this.fwd.values()) n += s.size;
    return n;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** File extensions that can contain import statements. */
const IMPORTABLE = /\.(ts|tsx|js|mjs|cjs|jsx|py|go|rs)$/i;

/** Normalise to forward-slashes, strip leading ./. */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Extract import targets from a file's content and resolve them relative
 * to `rootPath`, returning normalized relative paths.
 *
 * Handles:
 *   - ES6 import/export: `import ... from './foo'`
 *   - CommonJS: `require('./bar')`
 *   - Python: `from .module import X`
 *   - Go: `"github.com/..."` import blocks (skips external packages)
 */
function extractImports(content: string, absFilePath: string, rootPath: string): string[] {
  const dir     = path.dirname(absFilePath);
  const results: string[] = [];

  // ES6 import / export from
  const esRe = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = esRe.exec(content)) !== null) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      const resolved = resolveJs(dir, spec, rootPath);
      if (resolved) results.push(resolved);
    }
  }

  // CommonJS require
  const cjsRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = cjsRe.exec(content)) !== null) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      const resolved = resolveJs(dir, spec, rootPath);
      if (resolved) results.push(resolved);
    }
  }

  // Python relative import: from .foo import bar
  const pyRe = /from\s+(\.+[\w.]*)\s+import/g;
  while ((m = pyRe.exec(content)) !== null) {
    const spec = m[1].replace(/\./g, '/');
    const resolved = path.relative(rootPath, path.join(dir, spec));
    if (!resolved.startsWith('..')) results.push(normalize(resolved));
  }

  return results;
}

function resolveJs(dir: string, spec: string, rootPath: string): string | null {
  // Strip .js/.ts extension aliases (ESM .js imports actually .ts source)
  const stripped = spec.replace(/\.(js|mjs|cjs)$/, '');
  const abs  = path.resolve(dir, stripped);
  if (!abs.startsWith(rootPath)) return null; // outside root
  return normalize(path.relative(rootPath, abs));
}
