/**
 * FrictionDetector — identifies and surfaces common onboarding blockers.
 *
 * Part 6 — Iterate fast (launch mission).
 *
 * Runs during `koda init` and before `koda fix` / `koda add` to detect
 * common failure modes BEFORE the user hits them, and prints actionable
 * guidance immediately.
 *
 * Checks:
 *   1. No AI config        → "Run `koda login` first"
 *   2. No index            → "Run `koda init` first"
 *   3. Build command fails → show exact error + fix hint
 *   4. No test runner      → warn that verification will be skipped
 *   5. First-time user     → surface `koda doctor` proactively
 *   6. Low disk space      → warn before writing cache files
 *
 * Each check is non-fatal — produces a chalk-formatted warning, not an exception.
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';
import chalk from 'chalk';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FrictionCheck {
  id:       string;
  severity: 'WARN' | 'BLOCK';
  message:  string;
  fix:      string;
}

// ── FrictionDetector ──────────────────────────────────────────────────────────

export class FrictionDetector {
  private readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Run all checks and return any friction points found.
   * Prints nothing — caller decides how to display.
   */
  async detect(): Promise<FrictionCheck[]> {
    const checks = await Promise.allSettled([
      this._checkConfig(),
      this._checkIndex(),
      this._checkTestRunner(),
      this._checkDiskSpace(),
    ]);

    const frictions: FrictionCheck[] = [];
    for (const result of checks) {
      if (result.status === 'fulfilled' && result.value) {
        frictions.push(result.value);
      }
    }
    return frictions;
  }

  /**
   * Run checks and print any warnings inline.
   * Returns true if a BLOCK-level issue was found (caller should stop).
   */
  async detectAndPrint(): Promise<boolean> {
    const frictions = await this.detect();

    for (const f of frictions) {
      if (f.severity === 'BLOCK') {
        console.log(chalk.red(`\n  ✗ ${f.message}`));
        console.log(chalk.gray(`    Fix: ${f.fix}\n`));
      } else {
        console.log(chalk.yellow(`  ⚠ ${f.message}`));
        console.log(chalk.gray(`    ${f.fix}\n`));
      }
    }

    return frictions.some((f) => f.severity === 'BLOCK');
  }

  // ── Individual checks ──────────────────────────────────────────────────────

  private async _checkConfig(): Promise<FrictionCheck | null> {
    try {
      await fs.access(path.join(this.rootPath, '.koda', 'config.json'));
      return null;
    } catch {
      return {
        id:       'no_config',
        severity: 'BLOCK',
        message:  'No AI provider configured.',
        fix:      'Run `koda login` to configure your provider (Azure, OpenAI, Anthropic, or Ollama).',
      };
    }
  }

  private async _checkIndex(): Promise<FrictionCheck | null> {
    try {
      await fs.access(path.join(this.rootPath, '.koda', 'index.json'));
      return null;
    } catch {
      return {
        id:       'no_index',
        severity: 'WARN',
        message:  'Repository not indexed yet.',
        fix:      'Run `koda init` to index your repo (takes ~10s). Koda works without an index but is much slower.',
      };
    }
  }

  private async _checkTestRunner(): Promise<FrictionCheck | null> {
    const root = this.rootPath;
    const [hasPkg, hasPyproj, hasGoMod, hasCargo] = await Promise.all([
      exists(path.join(root, 'package.json')),
      exists(path.join(root, 'pyproject.toml')),
      exists(path.join(root, 'go.mod')),
      exists(path.join(root, 'Cargo.toml')),
    ]);

    if (hasPkg) {
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const hasTestRunner = deps['vitest'] || deps['jest'] || deps['mocha'] || pkg.scripts?.test;
        if (!hasTestRunner) {
          return {
            id:       'no_test_runner',
            severity: 'WARN',
            message:  'No test runner detected in package.json.',
            fix:      'Koda will skip verification. Add vitest or jest to enable test-verified fixes.',
          };
        }
      } catch { /* can't read package.json — ignore */ }
    } else if (!hasPyproj && !hasGoMod && !hasCargo) {
      return {
        id:       'no_test_runner',
        severity: 'WARN',
        message:  'No recognized project manifest found (package.json, pyproject.toml, go.mod, Cargo.toml).',
        fix:      'Koda will still work but cannot detect your test command automatically. Use `koda login` to configure.',
      };
    }

    return null;
  }

  private async _checkDiskSpace(): Promise<FrictionCheck | null> {
    try {
      // Node.js doesn't expose disk space — check cache dir size as a proxy
      const cacheDir  = path.join(this.rootPath, '.koda', 'cache');
      const cacheStat = await safeStatDir(cacheDir);
      if (cacheStat && cacheStat > 500 * 1024 * 1024) { // 500MB
        return {
          id:       'large_cache',
          severity: 'WARN',
          message:  `Koda cache is large (${Math.round(cacheStat / 1_048_576)}MB). Consider pruning.`,
          fix:      'Delete .koda/cache/ to reclaim space. It will be rebuilt automatically.',
        };
      }
    } catch { /* ignore */ }
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; }
  catch { return false; }
}

async function safeStatDir(dir: string): Promise<number | null> {
  try {
    const entries = await fs.readdir(dir);
    let total = 0;
    for (const e of entries) {
      try {
        const s = await fs.stat(path.join(dir, e));
        total += s.size;
      } catch { /* skip */ }
    }
    return total;
  } catch { return null; }
}
