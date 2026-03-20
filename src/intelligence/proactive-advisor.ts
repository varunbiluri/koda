/**
 * ProactiveAdvisor — generates post-task suggestions based on what changed.
 *
 * After each successful task, Koda scans the modified files and suggests
 * follow-up actions that a senior engineer would naturally think of:
 *
 *   - "You changed auth.ts — there's no corresponding test file"
 *   - "This module has no tests"
 *   - "src/utils/helper.ts is not imported by anything"
 *   - "You added a new export — consider updating the barrel index"
 *
 * Rules are kept as simple heuristics (no LLM call needed) so they run
 * instantly and never add to the token budget.
 *
 * Usage:
 * ```ts
 * const advisor = new ProactiveAdvisor(rootPath, repoGraph);
 * const suggestions = await advisor.suggest(filesChanged);
 * for (const s of suggestions) ui.stream(`INFO SUGGEST: ${s}`);
 * ```
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import type { RepoGraph } from './repo-graph.js';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Suggestion {
  /** Short action label (shown in bold in the terminal). */
  action:  string;
  /** Full sentence displayed to the user. */
  message: string;
  /** Urgency: 'info' (gray), 'warn' (yellow), 'tip' (cyan). */
  level:   'info' | 'warn' | 'tip';
}

// ── ProactiveAdvisor ───────────────────────────────────────────────────────────

export class ProactiveAdvisor {
  constructor(
    private readonly rootPath: string,
    private readonly graph:    RepoGraph,
  ) {}

  /**
   * Generate suggestions for the given list of changed files.
   * Returns an empty array when no actionable suggestions are found.
   */
  async suggest(filesChanged: string[]): Promise<Suggestion[]> {
    if (filesChanged.length === 0) return [];

    const results: Suggestion[] = [];

    await Promise.all(filesChanged.map(async (f) => {
      const suggestions = await this._analyzeFile(f);
      results.push(...suggestions);
    }));

    // Deduplicate by action label
    const seen = new Set<string>();
    return results.filter((s) => {
      if (seen.has(s.action)) return false;
      seen.add(s.action);
      return true;
    });
  }

  /**
   * Format suggestions as terminal-ready INFO SUGGEST lines for `ui.stream()`.
   */
  formatForStream(suggestions: Suggestion[]): string[] {
    return suggestions.map((s) => {
      const prefix = s.level === 'warn' ? 'WARN' : 'INFO';
      return `${prefix} SUGGEST: ${s.action} — ${s.message}`;
    });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _analyzeFile(filePath: string): Promise<Suggestion[]> {
    const results: Suggestion[] = [];
    const ext = path.extname(filePath).toLowerCase();

    // Only analyse source files
    if (!['.ts', '.tsx', '.js', '.mjs', '.py', '.go', '.rs'].includes(ext)) {
      return results;
    }

    const rel = filePath.startsWith(this.rootPath)
      ? path.relative(this.rootPath, filePath)
      : filePath;

    // ── Rule 1: Missing test file ─────────────────────────────────────────
    if (!isTestFile(rel)) {
      const hasTest = await this._hasTestFile(rel);
      if (!hasTest) {
        results.push({
          action:  `add tests for ${path.basename(rel)}`,
          message: `No test file found for ${rel} — consider writing tests`,
          level:   'warn',
        });
      }
    }

    // ── Rule 2: Zero dependents (possibly dead code) ──────────────────────
    if (!isTestFile(rel) && !isIndexFile(rel)) {
      const dependents = this.graph.getDirectDependents(rel);
      if (dependents.size === 0) {
        results.push({
          action:  `check if ${path.basename(rel)} is used`,
          message: `${rel} has no known importers — it may be unused or a new entry point`,
          level:   'info',
        });
      }
    }

    // ── Rule 3: Index/barrel file missing a new export ────────────────────
    try {
      const content    = await fs.readFile(path.join(this.rootPath, rel), 'utf8');
      const dir        = path.dirname(rel);
      const indexFile  = await this._findIndexFile(dir);
      if (indexFile) {
        const newExports = extractExportedNames(content);
        const indexContent = await fs.readFile(
          path.join(this.rootPath, indexFile), 'utf8',
        );
        const missingInIndex = newExports.filter(
          (name) => !indexContent.includes(name),
        );
        if (missingInIndex.length > 0) {
          results.push({
            action:  `update barrel index for ${path.basename(dir)}`,
            message: `${indexFile} may be missing exports: ${missingInIndex.slice(0, 3).join(', ')}`,
            level:   'tip',
          });
        }
      }
    } catch {
      // non-fatal
    }

    // ── Rule 4: High-impact change ────────────────────────────────────────
    const impact = this.graph.impactReport([rel]);
    if (impact.level === 'HIGH') {
      results.push({
        action:  `run full test suite`,
        message: `${rel} is imported by ${impact.affectedCount} files — run tests to check for regressions`,
        level:   'warn',
      });
    }

    return results;
  }

  private async _hasTestFile(relPath: string): Promise<boolean> {
    const base = path.basename(relPath, path.extname(relPath));
    const dir  = path.dirname(relPath);

    const candidates = [
      `${dir}/${base}.test${path.extname(relPath)}`,
      `${dir}/${base}.spec${path.extname(relPath)}`,
      `tests/${relPath}`,
      `tests/${dir}/${base}.test${path.extname(relPath)}`,
      `__tests__/${base}.test${path.extname(relPath)}`,
    ];

    for (const c of candidates) {
      try {
        await fs.access(path.join(this.rootPath, c));
        return true;
      } catch {
        // not found
      }
    }
    return false;
  }

  private async _findIndexFile(dir: string): Promise<string | null> {
    const candidates = ['index.ts', 'index.js', 'index.tsx', 'mod.ts'];
    for (const c of candidates) {
      try {
        await fs.access(path.join(this.rootPath, dir, c));
        return `${dir}/${c}`;
      } catch {
        // not found
      }
    }
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isTestFile(relPath: string): boolean {
  return /\.(test|spec)\.[a-z]+$/i.test(relPath) ||
         relPath.includes('__tests__') ||
         relPath.includes('/tests/');
}

function isIndexFile(relPath: string): boolean {
  return /\/(index|mod)\.[a-z]+$/i.test(relPath);
}

function extractExportedNames(content: string): string[] {
  const names: string[] = [];
  // export const/function/class/type Foo
  const re = /^\s*export\s+(?:const|function|class|type|interface|enum)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    names.push(m[1]);
  }
  // export { Foo, Bar }
  const reBlock = /export\s*\{([^}]+)\}/g;
  while ((m = reBlock.exec(content)) !== null) {
    const parts = m[1].split(',').map((p) => p.trim().split(/\s+as\s+/)[0].trim());
    names.push(...parts.filter(Boolean));
  }
  return [...new Set(names)];
}

/** Singleton factory for sharing a ProactiveAdvisor within a session. */
export function createProactiveAdvisor(rootPath: string, graph: RepoGraph): ProactiveAdvisor {
  return new ProactiveAdvisor(rootPath, graph);
}
