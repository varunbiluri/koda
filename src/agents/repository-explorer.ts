/**
 * RepositoryExplorer — deterministic, LLM-free filesystem exploration.
 *
 * Scans the repository to produce a structured RepositoryContext used by
 * SupervisorAgent before delegating to CodingAgent on complex tasks.
 *
 * The explorer uses glob patterns and heuristics only — no LLM calls —
 * so it is fast, cheap, and reproducible.
 *
 * Typical output (serialised as a compact summary string):
 *   Entry points:  src/index.ts, src/cli.ts
 *   Key modules:   src/ai/, src/agents/, src/tools/
 *   API routes:    src/api/routes/*.ts
 *   Test files:    tests/**
 *   Config files:  tsconfig.json, package.json
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface RepositoryContext {
  /** Top-level entry points (index/main/cli files). */
  entryPoints:    string[];
  /** Key module directories (≥ 3 source files inside). */
  keyModules:     string[];
  /** Files that define API routes / HTTP handlers. */
  apiRoutes:      string[];
  /** Database schema / migration / model files. */
  databaseFiles:  string[];
  /** Files ranked as important by heuristics (exported classes, interfaces). */
  importantFiles: string[];
  /** Test files. */
  testFiles:      string[];
  /** Project config files. */
  configFiles:    string[];
  /** Compact human-readable summary for prompt injection. */
  summary:        string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Recursively list files under `dir`, skipping common noise directories. */
async function listFiles(dir: string, maxDepth = 5, depth = 0): Promise<string[]> {
  if (depth > maxDepth) return [];

  const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'coverage',
    '.koda', '.next', '.nuxt', '__pycache__', '.venv',
  ]);

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...await listFiles(fullPath, maxDepth, depth + 1));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/** Return true if `file` looks like a source code file. */
function isSourceFile(file: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|cs|cpp|c|h)$/.test(file);
}

/** Return true if `file` looks like an API route / HTTP handler. */
function isApiRoute(file: string): boolean {
  return /\/(routes?|controllers?|handlers?|endpoints?)\//i.test(file) ||
         /\.(route|controller|handler|endpoint)\.[^/]+$/.test(file);
}

/** Return true if `file` looks like a database file. */
function isDatabaseFile(file: string): boolean {
  return /\/(models?|migrations?|schema|entities?|repositories?)\//i.test(file) ||
         /\.(model|migration|schema|entity)\.[^/]+$/.test(file) ||
         /\/(prisma|sequelize|typeorm|mongoose)\//i.test(file);
}

/** Return true if `file` looks like a config file. */
function isConfigFile(file: string): boolean {
  return /\.(json|yaml|yml|toml|ini|env|config\..*|rc)$/.test(path.basename(file)) ||
         /\/(config|configs?)\//i.test(file);
}

/** Return true if `file` looks like a test file. */
function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[^/]+$/.test(file) ||
         /\/(tests?|__tests?__|spec)\//i.test(file);
}

/** Return true if `file` is a common entry point. */
function isEntryPoint(file: string): boolean {
  const base = path.basename(file);
  return /^(index|main|cli|app|server|start)\.[^/]+$/.test(base);
}

/** Group source files by their immediate parent directory.
 *  Returns directories containing >= `threshold` source files. */
function keyModuleDirs(files: string[], threshold = 3): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (!isSourceFile(f)) continue;
    const dir = path.dirname(f);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d)
    .slice(0, 10);
}

/** Shorten an absolute path to be relative to `rootPath`. */
function rel(rootPath: string, absPath: string): string {
  return path.relative(rootPath, absPath) || absPath;
}

// ── RepositoryExplorer ──────────────────────────────────────────────────────

export class RepositoryExplorer {
  constructor(private readonly rootPath: string) {}

  /**
   * Explore the repository and return a structured RepositoryContext.
   *
   * Caps results to avoid bloating prompts:
   *   entryPoints:    ≤ 5
   *   keyModules:     ≤ 10
   *   apiRoutes:      ≤ 15
   *   databaseFiles:  ≤ 10
   *   importantFiles: ≤ 20
   *   testFiles:      ≤ 10
   *   configFiles:    ≤ 8
   */
  async explore(): Promise<RepositoryContext> {
    logger.debug(`[repo-explorer] Exploring: ${this.rootPath}`);

    const allFiles = await listFiles(this.rootPath);

    const entryPoints    = allFiles.filter(isEntryPoint)
                                   .filter(isSourceFile)
                                   .map((f) => rel(this.rootPath, f))
                                   .slice(0, 5);

    const apiRoutes      = allFiles.filter(isApiRoute)
                                   .filter(isSourceFile)
                                   .map((f) => rel(this.rootPath, f))
                                   .slice(0, 15);

    const databaseFiles  = allFiles.filter(isDatabaseFile)
                                   .filter(isSourceFile)
                                   .map((f) => rel(this.rootPath, f))
                                   .slice(0, 10);

    const testFiles      = allFiles.filter(isTestFile)
                                   .map((f) => rel(this.rootPath, f))
                                   .slice(0, 10);

    const configFiles    = allFiles.filter(isConfigFile)
                                   .filter((f) => !isTestFile(f))
                                   .map((f) => rel(this.rootPath, f))
                                   .slice(0, 8);

    const importantFiles = allFiles
      .filter(isSourceFile)
      .filter((f) => !isTestFile(f) && !isEntryPoint(f))
      .map((f) => rel(this.rootPath, f))
      .slice(0, 20);

    const keyModules     = keyModuleDirs(allFiles)
      .map((d) => rel(this.rootPath, d));

    const ctx: RepositoryContext = {
      entryPoints,
      keyModules,
      apiRoutes,
      databaseFiles,
      importantFiles,
      testFiles,
      configFiles,
      summary: buildSummary({
        entryPoints, keyModules, apiRoutes, databaseFiles,
        importantFiles, testFiles, configFiles,
      }),
    };

    logger.debug(
      `[repo-explorer] Found ${allFiles.length} files — ` +
      `${entryPoints.length} entry, ${keyModules.length} modules, ` +
      `${apiRoutes.length} routes, ${testFiles.length} tests`,
    );

    return ctx;
  }
}

// ── Summary builder ──────────────────────────────────────────────────────────

function buildSummary(ctx: Omit<RepositoryContext, 'summary'>): string {
  const lines: string[] = ['## Repository Structure'];

  if (ctx.entryPoints.length > 0) {
    lines.push(`Entry points: ${ctx.entryPoints.join(', ')}`);
  }
  if (ctx.keyModules.length > 0) {
    lines.push(`Key modules: ${ctx.keyModules.join(', ')}`);
  }
  if (ctx.apiRoutes.length > 0) {
    lines.push(`API routes: ${ctx.apiRoutes.slice(0, 5).join(', ')}${ctx.apiRoutes.length > 5 ? ` (+${ctx.apiRoutes.length - 5} more)` : ''}`);
  }
  if (ctx.databaseFiles.length > 0) {
    lines.push(`Database: ${ctx.databaseFiles.slice(0, 3).join(', ')}${ctx.databaseFiles.length > 3 ? ` (+${ctx.databaseFiles.length - 3} more)` : ''}`);
  }
  if (ctx.configFiles.length > 0) {
    lines.push(`Config: ${ctx.configFiles.join(', ')}`);
  }
  if (ctx.testFiles.length > 0) {
    lines.push(`Tests: ${ctx.testFiles.slice(0, 3).join(', ')}${ctx.testFiles.length > 3 ? ` (+${ctx.testFiles.length - 3} more)` : ''}`);
  }

  return lines.join('\n');
}
