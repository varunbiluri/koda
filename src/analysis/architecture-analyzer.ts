import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import type { RepoIndex } from '../types/index.js';
import type { DependencyEdge } from '../types/dependency.js';
import { logger } from '../utils/logger.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ArchitectureSummary {
  /** Main source module directories (src/, lib/, app/, etc.) */
  modules:         string[];
  /** Detected entry point files (index.ts, main.ts, server.ts, etc.) */
  entryPoints:     string[];
  /** Files with the highest in-degree (most imported — architecturally central). */
  importantFiles:  string[];
  /** Detected API route files */
  apiRoutes:       string[];
  /** Detected database / ORM layer files */
  databaseLayer:   string[];
  /** Detected test framework */
  testFramework:   string | null;
  /** Condensed dependency graph: file → direct imports (top 15 files only). */
  dependencyGraph: Record<string, string[]>;
}

// ── ArchitectureAnalyzer ──────────────────────────────────────────────────────

/**
 * ArchitectureAnalyzer — produces a lightweight architectural summary of the
 * repository by combining the indexed dependency graph with filesystem
 * heuristics.
 *
 * The summary is injected into the PlanningEngine prompt so the LLM can
 * generate plans that respect the actual module layout rather than guessing.
 */
export class ArchitectureAnalyzer {
  constructor(
    private readonly rootPath: string,
    private readonly index:    RepoIndex | null,
  ) {}

  async analyze(): Promise<ArchitectureSummary> {
    const [modules, entryPoints, testFramework] = await Promise.all([
      this.detectModules(),
      this.detectEntryPoints(),
      this.detectTestFramework(),
    ]);

    const importantFiles  = this.findImportantFiles();
    const apiRoutes       = this.findApiRoutes();
    const databaseLayer   = this.findDatabaseLayer();
    const dependencyGraph = this.buildCondensedGraph(importantFiles);

    return {
      modules,
      entryPoints,
      importantFiles,
      apiRoutes,
      databaseLayer,
      testFramework,
      dependencyGraph,
    };
  }

  // ── Module detection ───────────────────────────────────────────────────────

  private async detectModules(): Promise<string[]> {
    const candidates = ['src', 'lib', 'app', 'packages', 'modules', 'core', 'api', 'server'];
    const found: string[] = [];

    await Promise.all(
      candidates.map(async (dir) => {
        try {
          const s = await fs.stat(path.join(this.rootPath, dir));
          if (s.isDirectory()) found.push(dir);
        } catch {
          // not present
        }
      }),
    );

    // Also extract top-level source dirs from the index
    if (this.index) {
      const topDirs = new Set<string>();
      for (const f of this.index.files) {
        const rel = f.path.startsWith(this.rootPath)
          ? f.path.slice(this.rootPath.length + 1)
          : f.path;
        const first = rel.split('/')[0];
        if (first && first !== '.' && !first.startsWith('.') && !found.includes(first)) {
          topDirs.add(first);
        }
      }
      // Add directories that appear frequently (contain many files) and aren't
      // already captured — limit to top 5 by frequency
      const counts: Record<string, number> = {};
      for (const d of topDirs) counts[d] = (counts[d] ?? 0) + 1;
      const extras = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([d]) => d)
        .filter((d) => !found.includes(d));
      found.push(...extras);
    }

    return found.slice(0, 10);
  }

  // ── Entry point detection ──────────────────────────────────────────────────

  private async detectEntryPoints(): Promise<string[]> {
    const patterns = [
      'src/index.ts', 'src/index.js',
      'src/main.ts',  'src/main.js',
      'src/server.ts','src/server.js',
      'src/app.ts',   'src/app.js',
      'index.ts',     'index.js',
      'main.ts',      'main.js',
      'server.ts',    'server.js',
    ];

    const found: string[] = [];
    await Promise.all(
      patterns.map(async (p) => {
        try {
          await fs.access(path.join(this.rootPath, p));
          found.push(p);
        } catch {
          // not present
        }
      }),
    );

    return found.slice(0, 5);
  }

  // ── Important files (highest in-degree) ───────────────────────────────────

  private findImportantFiles(): string[] {
    if (!this.index || this.index.nodes.length === 0) return [];

    return [...this.index.nodes]
      .filter((n) => n.inDegree > 0)
      .sort((a, b) => b.inDegree - a.inDegree)
      .slice(0, 10)
      .map((n) => {
        // Return repo-relative path
        const rel = n.filePath.startsWith(this.rootPath)
          ? n.filePath.slice(this.rootPath.length + 1)
          : n.filePath;
        return rel;
      });
  }

  // ── API route detection ────────────────────────────────────────────────────

  private findApiRoutes(): string[] {
    if (!this.index) return [];

    const routePatterns = [
      /routes?\//i,
      /controllers?\//i,
      /handlers?\//i,
      /endpoints?\//i,
      /api\//i,
    ];

    const routeFiles = new Set<string>();
    for (const f of this.index.files) {
      const rel = f.path.startsWith(this.rootPath)
        ? f.path.slice(this.rootPath.length + 1)
        : f.path;
      if (routePatterns.some((p) => p.test(rel))) {
        routeFiles.add(rel);
      }
    }

    return Array.from(routeFiles).slice(0, 10);
  }

  // ── Database layer detection ───────────────────────────────────────────────

  private findDatabaseLayer(): string[] {
    if (!this.index) return [];

    const dbPatterns = [
      /models?\//i,
      /entities?\//i,
      /schemas?\//i,
      /migrations?\//i,
      /repositories?\//i,
      /dao\//i,
      /db\//i,
      /database\//i,
      /prisma/i,
      /drizzle/i,
      /typeorm/i,
      /sequelize/i,
    ];

    const dbFiles = new Set<string>();
    for (const f of this.index.files) {
      const rel = f.path.startsWith(this.rootPath)
        ? f.path.slice(this.rootPath.length + 1)
        : f.path;
      if (dbPatterns.some((p) => p.test(rel))) {
        dbFiles.add(rel);
      }
    }

    return Array.from(dbFiles).slice(0, 8);
  }

  // ── Test framework detection ───────────────────────────────────────────────

  private async detectTestFramework(): Promise<string | null> {
    try {
      const pkgRaw = await fs.readFile(
        path.join(this.rootPath, 'package.json'),
        'utf-8',
      );
      const pkg = JSON.parse(pkgRaw) as {
        devDependencies?: Record<string, string>;
        dependencies?:    Record<string, string>;
      };
      const deps = {
        ...pkg.devDependencies,
        ...pkg.dependencies,
      };
      if (deps['vitest'])    return 'vitest';
      if (deps['jest'])      return 'jest';
      if (deps['mocha'])     return 'mocha';
      if (deps['jasmine'])   return 'jasmine';
      if (deps['pytest'])    return 'pytest';
    } catch {
      // Not a Node project or no package.json
    }
    return null;
  }

  // ── Condensed dependency graph ─────────────────────────────────────────────

  /**
   * Build a condensed dependency graph: for each important file, list its
   * direct imports.  Capped to the most-imported files to keep prompt size
   * manageable.
   */
  private buildCondensedGraph(importantFiles: string[]): Record<string, string[]> {
    if (!this.index || this.index.edges.length === 0) return {};

    const graph: Record<string, string[]> = {};
    const edgesBySource = new Map<string, DependencyEdge[]>();

    for (const edge of this.index.edges) {
      const src = edge.source.startsWith(this.rootPath)
        ? edge.source.slice(this.rootPath.length + 1)
        : edge.source;
      const existing = edgesBySource.get(src) ?? [];
      existing.push(edge);
      edgesBySource.set(src, existing);
    }

    // Include top 15 files: important (high in-degree) + their neighbors
    const fileSet = new Set(importantFiles.slice(0, 15));

    for (const file of fileSet) {
      const edges = edgesBySource.get(file) ?? [];
      if (edges.length > 0) {
        graph[file] = edges
          .map((e) => {
            const rel = e.target.startsWith(this.rootPath)
              ? e.target.slice(this.rootPath.length + 1)
              : e.target;
            return rel;
          })
          .slice(0, 5); // max 5 imports per file to keep compact
      }
    }

    return graph;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format an ArchitectureSummary as a compact text block for LLM injection.
 */
export function formatArchitectureSummary(summary: ArchitectureSummary): string {
  const lines: string[] = ['## Architecture Summary', ''];

  if (summary.entryPoints.length > 0) {
    lines.push(`Entry points: ${summary.entryPoints.join(', ')}`);
  }
  if (summary.modules.length > 0) {
    lines.push(`Source modules: ${summary.modules.join(', ')}`);
  }
  if (summary.testFramework) {
    lines.push(`Test framework: ${summary.testFramework}`);
  }
  if (summary.importantFiles.length > 0) {
    lines.push('');
    lines.push('Core files (most imported):');
    for (const f of summary.importantFiles.slice(0, 6)) {
      lines.push(`  • ${f}`);
    }
  }
  if (summary.apiRoutes.length > 0) {
    lines.push('');
    lines.push(`API routes: ${summary.apiRoutes.slice(0, 5).join(', ')}`);
  }
  if (summary.databaseLayer.length > 0) {
    lines.push(`DB layer: ${summary.databaseLayer.slice(0, 4).join(', ')}`);
  }
  if (Object.keys(summary.dependencyGraph).length > 0) {
    lines.push('');
    lines.push('Key dependencies:');
    for (const [file, deps] of Object.entries(summary.dependencyGraph).slice(0, 5)) {
      lines.push(`  ${file} → ${deps.join(', ')}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── Module-level convenience ──────────────────────────────────────────────────

/**
 * Analyze a repository and return its architectural summary.
 * Non-fatal: returns an empty summary if analysis fails.
 */
export async function analyzeArchitecture(
  rootPath: string,
  index:    RepoIndex | null,
): Promise<ArchitectureSummary> {
  try {
    return await new ArchitectureAnalyzer(rootPath, index).analyze();
  } catch (err) {
    logger.warn(`[architecture-analyzer] Failed: ${(err as Error).message}`);
    return {
      modules:         [],
      entryPoints:     [],
      importantFiles:  [],
      apiRoutes:       [],
      databaseLayer:   [],
      testFramework:   null,
      dependencyGraph: {},
    };
  }
}
