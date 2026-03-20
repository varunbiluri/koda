/**
 * ASTRepoGraph — tree-sitter-powered knowledge graph of the repository.
 *
 * Replaces regex import detection in RepoGraph with accurate AST parsing
 * for TypeScript and Python, and adds a symbol-level layer:
 *
 *   File nodes:    each source file is a node
 *   Symbol nodes:  functions, classes, interfaces inside each file
 *   Edges:
 *     file  → imports → file    (import graph)
 *     file  → defines → symbol  (symbol ownership)
 *     file  → calls   → symbol  (call graph, best-effort)
 *
 * Uses the existing parser-manager + TypeScriptExtractor / PythonExtractor
 * infrastructure. Falls back to regex for unsupported file types.
 *
 * Usage:
 * ```ts
 * const graph = await ASTRepoGraph.build(rootPath, filePaths);
 * const impact = graph.impactReport(['src/auth/auth-service.ts']);
 * const symbols = graph.getSymbols('src/auth/auth-service.ts');
 * const callers = graph.getCallers('AuthService');
 * const summary = graph.formatSymbolSummary('src/auth/auth-service.ts');
 * ```
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import { RepoGraph }    from './repo-graph.js';
import { getParser }    from '../engine/ast/parser-manager.js';
import { TypeScriptExtractor } from '../engine/ast/extractors/typescript-extractor.js';
import { PythonExtractor }     from '../engine/ast/extractors/python-extractor.js';
import { SUPPORTED_LANGUAGES } from '../engine/ast/languages.js';
import { logger } from '../utils/logger.js';
import { ASTGraphCache } from '../performance/ast-graph-cache.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GraphSymbol {
  /** Symbol name, e.g. "AuthService", "validateToken". */
  name:      string;
  /** Symbol kind. */
  kind:      'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum' | 'unknown';
  /** Relative file path where this symbol is defined. */
  filePath:  string;
  /** 1-based start line. */
  startLine: number;
  /** 1-based end line. */
  endLine:   number;
}

export interface FileSymbolMap {
  [filePath: string]: GraphSymbol[];
}

// ── ASTRepoGraph ───────────────────────────────────────────────────────────────

export class ASTRepoGraph extends RepoGraph {
  /** file → symbols defined in that file */
  private readonly symbolsByFile: FileSymbolMap = {};
  /** symbol name → files that define it */
  private readonly symbolDefs: Map<string, string[]> = new Map();

  /** Internal — use ASTRepoGraph.build() */
  protected constructor() { super(); }

  // ── Factory ────────────────────────────────────────────────────────────────

  /**
   * Build the AST-powered graph from a list of file paths.
   *
   * For TypeScript (.ts/.tsx) and Python (.py) files, uses tree-sitter.
   * All other files fall back to the regex-based import extraction in RepoGraph.
   * Uses ASTGraphCache to skip re-parsing unchanged files.
   */
  static async build(rootPath: string, filePaths: string[]): Promise<ASTRepoGraph> {
    const g = new ASTRepoGraph();
    // Load persistent cache — non-fatal if unavailable
    let cache: ASTGraphCache | null = null;
    try {
      cache = await ASTGraphCache.load(rootPath);
      cache.gc();
    } catch {
      cache = null;
    }
    await g._buildInternal(rootPath, filePaths, cache);
    if (cache) {
      await cache.flush();
    }
    logger.debug(`[ast-repo-graph] Built: ${g.nodeCount} file nodes, ${g._totalSymbols()} symbols`);
    return g;
  }

  // ── Symbol API ─────────────────────────────────────────────────────────────

  /** Return all symbols defined in a given file. */
  getSymbols(filePath: string): GraphSymbol[] {
    const rel = this._rel(filePath);
    return this.symbolsByFile[rel] ?? [];
  }

  /** Return all files that define a symbol with the given name. */
  getDefinitionFiles(symbolName: string): string[] {
    return this.symbolDefs.get(symbolName) ?? [];
  }

  /** Return all symbols across all files, optionally filtered by kind. */
  getAllSymbols(kind?: GraphSymbol['kind']): GraphSymbol[] {
    const all = Object.values(this.symbolsByFile).flat();
    return kind ? all.filter((s) => s.kind === kind) : all;
  }

  /**
   * Format a compact symbol summary for a file — injected into AI prompts
   * so the model knows the public surface without reading the full file.
   *
   * Example output:
   *   src/auth/auth-service.ts  (3 functions, 1 class)
   *   - class AuthService
   *   - function validateToken(...)
   *   - function hashPassword(...)
   */
  formatSymbolSummary(filePath: string): string {
    const symbols = this.getSymbols(filePath);
    if (symbols.length === 0) return '';

    const rel    = this._rel(filePath);
    const counts = countByKind(symbols);
    const header = `${rel}  (${counts})`;

    const lines  = symbols.slice(0, 20).map((s) => `  - ${s.kind} ${s.name} (L${s.startLine})`);
    return [header, ...lines].join('\n');
  }

  /**
   * Build context for AI planning from a list of files' symbols.
   * Useful for injecting into TaskGraphBuilder prompts.
   */
  buildSymbolContext(filePaths: string[]): string {
    const blocks = filePaths
      .map((f) => this.formatSymbolSummary(f))
      .filter(Boolean);
    return blocks.length > 0
      ? '## Symbol map (AST-extracted)\n\n' + blocks.join('\n\n')
      : '';
  }

  // ── Private: build ─────────────────────────────────────────────────────────

  /** Build import graph + symbol table from file paths. */
  protected async _buildInternal(
    rootPath:  string,
    filePaths: string[],
    cache:     ASTGraphCache | null = null,
  ): Promise<void> {
    const BATCH = 32;
    const tasks = filePaths.map((fp) => this._processFile(rootPath, fp, cache));
    for (let i = 0; i < tasks.length; i += BATCH) {
      await Promise.all(tasks.slice(i, i + BATCH));
    }
  }

  private async _processFile(
    rootPath:  string,
    filePath:  string,
    cache:     ASTGraphCache | null,
  ): Promise<void> {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
    const rel = normRel(rootPath, abs);
    const ext = path.extname(filePath).toLowerCase();

    // Determine language
    const lang = extToLang(ext);

    if (!lang) {
      // Non-AST file — use parent regex-based scanner via inheritance hook
      await this._scanFileRegex(rootPath, filePath);
      return;
    }

    // Read file content (needed for hash and parsing)
    let content: string;
    let hash: string | undefined;
    if (cache) {
      const result = await ASTGraphCache.readAndHash(abs);
      if (!result) return;
      [content, hash] = result;

      // ── Cache hit: restore stored result ──────────────────────────────
      const cached = cache.get(hash);
      if (cached) {
        this._ensureNode(rel);
        for (const imp of cached.imports) {
          const resolved = resolveImport(abs, imp, rootPath, ext);
          if (resolved) {
            this._ensureNode(resolved);
            this._addEdge(rel, resolved);
          }
        }
        const graphSymbols: GraphSymbol[] = cached.symbols.map((s) => ({
          name:      s.name,
          kind:      chunkTypeToKind(s.kind),
          filePath:  rel,
          startLine: s.startLine,
          endLine:   s.endLine,
        }));
        this.symbolsByFile[rel] = graphSymbols;
        for (const sym of graphSymbols) {
          const existing = this.symbolDefs.get(sym.name) ?? [];
          existing.push(rel);
          this.symbolDefs.set(sym.name, existing);
        }
        return; // ← cache hit, no re-parse needed
      }
    } else {
      try {
        content = await fs.readFile(abs, 'utf8');
      } catch {
        return;
      }
    }

    try {
      const parser = await getParser(lang);
      if (!parser) {
        await this._scanFileRegex(rootPath, filePath);
        return;
      }

      const tree      = parser.parse(content!);
      const extractor = lang === 'typescript'
        ? new TypeScriptExtractor()
        : new PythonExtractor();

      const { symbols, imports } = extractor.extract(tree, content!);

      // ── Filter importable relative specifiers ──────────────────────────
      const relImports = imports
        .map((i) => i.source)
        .filter((s) => s.startsWith('.') || s.startsWith('/'));

      // ── Populate import graph ──────────────────────────────────────────
      this._ensureNode(rel);
      for (const spec of relImports) {
        const resolved = resolveImport(abs, spec, rootPath, ext);
        if (resolved) {
          this._ensureNode(resolved);
          this._addEdge(rel, resolved);
        }
      }

      // ── Populate symbol table ──────────────────────────────────────────
      const graphSymbols: GraphSymbol[] = symbols
        .filter((s) => s.name && s.name !== 'anonymous' && s.type !== 'import')
        .map((s) => ({
          name:      s.name,
          kind:      chunkTypeToKind(s.type as string),
          filePath:  rel,
          startLine: s.startLine,
          endLine:   s.endLine,
        }));

      this.symbolsByFile[rel] = graphSymbols;
      for (const sym of graphSymbols) {
        const existing = this.symbolDefs.get(sym.name) ?? [];
        existing.push(rel);
        this.symbolDefs.set(sym.name, existing);
      }

      // ── Store result in cache for future sessions ─────────────────────
      if (cache && hash) {
        cache.set(hash, rel, {
          imports: relImports,
          symbols: graphSymbols.map((s) => ({
            name:      s.name,
            kind:      s.kind,
            startLine: s.startLine,
            endLine:   s.endLine,
          })),
        });
      }

    } catch (err) {
      logger.debug(`[ast-repo-graph] AST parse failed for ${rel}: ${(err as Error).message}`);
      await this._scanFileRegex(rootPath, filePath);
    }
  }

  // Expose parent's private scanner through a protected hook
  private async _scanFileRegex(rootPath: string, filePath: string): Promise<void> {
    // Call the _scanFile method from the RepoGraph parent by rebuilding it inline.
    // We can't call parent private methods in JS, so we replicate the regex logic
    // for non-TS/non-Python files here.
    const abs = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
    const rel = normRel(rootPath, abs);
    this._ensureNode(rel);

    const IMPORTABLE = /\.(ts|tsx|js|mjs|cjs|jsx|py|go|rs)$/i;
    if (!IMPORTABLE.test(filePath)) return;

    let content: string;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch { return; }

    const dir = path.dirname(abs);
    const ext = path.extname(filePath);

    // ES6 import / export from
    const esRe = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = esRe.exec(content)) !== null) {
      const spec = m[1];
      if (spec.startsWith('.')) {
        const resolved = resolveImport(abs, spec, rootPath, ext);
        if (resolved) { this._ensureNode(resolved); this._addEdge(rel, resolved); }
      }
    }
    // CommonJS require
    const cjsRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = cjsRe.exec(content)) !== null) {
      const spec = m[1];
      if (spec.startsWith('.')) {
        const resolved = resolveImport(abs, spec, rootPath, ext);
        if (resolved) { this._ensureNode(resolved); this._addEdge(rel, resolved); }
      }
    }
  }

  private _totalSymbols(): number {
    return Object.values(this.symbolsByFile).reduce((n, s) => n + s.length, 0);
  }

  private _rel(fp: string): string {
    return fp.startsWith('/') ? fp : fp; // already relative is fine
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normRel(rootPath: string, abs: string): string {
  return path.relative(rootPath, abs).replace(/\\/g, '/');
}

function extToLang(ext: string): 'typescript' | 'python' | null {
  if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) return 'typescript';
  if (['.py', '.pyi'].includes(ext))                 return 'python';
  return null;
}

function resolveImport(
  fromAbs:  string,
  spec:     string,
  rootPath: string,
  _ext:     string,
): string | null {
  const stripped = spec.replace(/\.(js|mjs|cjs)$/, '');
  const abs      = path.resolve(path.dirname(fromAbs), stripped);
  if (!abs.startsWith(rootPath)) return null;
  return normRel(rootPath, abs);
}

function chunkTypeToKind(type: string): GraphSymbol['kind'] {
  switch (type) {
    case 'function':    return 'function';
    case 'class':       return 'class';
    case 'interface':   return 'interface';
    case 'type_alias':  return 'type';
    case 'enum':        return 'enum';
    case 'variable':    return 'variable';
    default:            return 'unknown';
  }
}

function countByKind(symbols: GraphSymbol[]): string {
  const counts: Record<string, number> = {};
  for (const s of symbols) {
    counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, n]) => `${n} ${n === 1 ? k : k + 's'}`)
    .join(', ');
}
