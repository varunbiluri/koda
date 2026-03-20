/**
 * RepoContextAnalyzer — detects language, framework, test runner, and build
 * commands by inspecting well-known manifest files.
 *
 * Reads (in order of precedence):
 *   package.json      → Node / TypeScript projects
 *   pyproject.toml    → Python projects (PEP 517+)
 *   go.mod            → Go modules
 *   Cargo.toml        → Rust (Cargo)
 *
 * The result is injected into the TaskGraphBuilder prompt so that every
 * generated node references the correct commands for the repo's actual
 * toolchain rather than generic placeholders.
 *
 * Usage:
 * ```ts
 * const ctx = await RepoContextAnalyzer.analyze('/path/to/repo');
 * // ctx.buildCommand  → 'pnpm build'
 * // ctx.testCommand   → 'pnpm test'
 * // ctx.framework     → 'Node (TypeScript, ESM)'
 * // ctx.formatForPrompt() → multi-line string for system prompt injection
 * ```
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RepoContext {
  /** Detected runtime/language, e.g. "Node (TypeScript, ESM)" or "Python 3.11". */
  runtime:        string;
  /** Primary framework detected, e.g. "Express", "Django", "Gin". */
  framework:      string | null;
  /** Package manager (npm / pnpm / yarn / pip / cargo / go). */
  packageManager: string;
  /** Command to build/compile the project. */
  buildCommand:   string;
  /** Command to run the test suite. */
  testCommand:    string;
  /** Command to install dependencies. */
  installCommand: string;
  /** Test runner name (vitest / jest / pytest / cargo-test / go-test). */
  testRunner:     string | null;

  /** Serialise to a compact string for system prompt injection. */
  formatForPrompt(): string;
}

// ── RepoContextAnalyzer ────────────────────────────────────────────────────────

export class RepoContextAnalyzer {
  /**
   * Analyse the repository at `rootPath` and return a `RepoContext`.
   * Never throws — falls back to generic defaults on any read / parse error.
   */
  static async analyze(rootPath: string): Promise<RepoContext> {
    // Try each manifest in priority order
    const node   = await tryParsePackageJson(rootPath);
    if (node) return node;

    const python = await tryParsePyproject(rootPath);
    if (python) return python;

    const golang = await tryParseGoMod(rootPath);
    if (golang) return golang;

    const rust   = await tryParseCargoToml(rootPath);
    if (rust) return rust;

    return makeContext({
      runtime:        'Unknown',
      framework:      null,
      packageManager: 'unknown',
      buildCommand:   'make build',
      testCommand:    'make test',
      installCommand: 'make install',
      testRunner:     null,
    });
  }
}

// ── Node / TypeScript ──────────────────────────────────────────────────────────

async function tryParsePackageJson(rootPath: string): Promise<RepoContext | null> {
  try {
    const raw  = await fs.readFile(path.join(rootPath, 'package.json'), 'utf8');
    const pkg  = JSON.parse(raw) as Record<string, unknown>;
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const deps    = {
      ...(pkg.dependencies        as Record<string, string> | undefined ?? {}),
      ...(pkg.devDependencies     as Record<string, string> | undefined ?? {}),
      ...(pkg.peerDependencies    as Record<string, string> | undefined ?? {}),
    };

    // ── Package manager ────────────────────────────────────────────────────
    const pm = detectNodePM(rootPath, pkg);

    // ── Runtime label ──────────────────────────────────────────────────────
    const isTypeScript  = 'typescript' in deps;
    const isESM         = (pkg.type as string | undefined) === 'module';
    const runtimeParts  = ['Node'];
    if (isTypeScript) runtimeParts.push('TypeScript');
    if (isESM)        runtimeParts.push('ESM');

    // ── Framework ─────────────────────────────────────────────────────────
    const framework = detectNodeFramework(deps);

    // ── Test runner ───────────────────────────────────────────────────────
    const testRunner = detectNodeTestRunner(deps, scripts);

    // ── Commands ──────────────────────────────────────────────────────────
    const buildCommand   = scripts['build']   ? `${pm} run build`   : `${pm} build`;
    const testCommand    = scripts['test']    ? `${pm} run test`    :
                           testRunner === 'vitest' ? `${pm} exec vitest` :
                           testRunner === 'jest'   ? `${pm} exec jest`   : `${pm} test`;
    const installCommand = pm === 'npm' ? 'npm install' : `${pm} install`;

    return makeContext({
      runtime:        runtimeParts.join(', '),
      framework,
      packageManager: pm,
      buildCommand,
      testCommand,
      installCommand,
      testRunner,
    });
  } catch {
    return null;
  }
}

function detectNodePM(rootPath: string, pkg: Record<string, unknown>): string {
  // packageManager field (corepack standard)
  const pmField = pkg.packageManager as string | undefined;
  if (pmField) {
    if (pmField.startsWith('pnpm'))  return 'pnpm';
    if (pmField.startsWith('yarn'))  return 'yarn';
    if (pmField.startsWith('bun'))   return 'bun';
  }
  // Heuristic: lock file presence (synchronous check skipped — use field only)
  void rootPath; // rootPath reserved for future lock-file detection
  return 'npm'; // safe default
}

function detectNodeFramework(deps: Record<string, string>): string | null {
  if ('express'    in deps) return 'Express';
  if ('fastify'    in deps) return 'Fastify';
  if ('koa'        in deps) return 'Koa';
  if ('hapi'       in deps || '@hapi/hapi' in deps) return 'Hapi';
  if ('next'       in deps) return 'Next.js';
  if ('nuxt'       in deps) return 'Nuxt';
  if ('react'      in deps) return 'React';
  if ('vue'        in deps) return 'Vue';
  if ('@angular/core' in deps) return 'Angular';
  if ('svelte'     in deps) return 'Svelte';
  if ('nestjs'     in deps || '@nestjs/core' in deps) return 'NestJS';
  return null;
}

function detectNodeTestRunner(
  deps:    Record<string, string>,
  scripts: Record<string, string>,
): string | null {
  if ('vitest' in deps)                      return 'vitest';
  if ('jest'   in deps || '@jest/core' in deps) return 'jest';
  if ('mocha'  in deps)                      return 'mocha';
  if ('tap'    in deps)                      return 'tap';
  // Detect from the test script value
  const testScript = scripts['test'] ?? '';
  if (/vitest/.test(testScript)) return 'vitest';
  if (/jest/.test(testScript))   return 'jest';
  if (/mocha/.test(testScript))  return 'mocha';
  return null;
}

// ── Python ─────────────────────────────────────────────────────────────────────

async function tryParsePyproject(rootPath: string): Promise<RepoContext | null> {
  try {
    const raw = await fs.readFile(path.join(rootPath, 'pyproject.toml'), 'utf8');

    // Extract python version hint
    const pyVer   = (raw.match(/python_requires\s*=\s*["']([^"']+)["']/) ?? [])[1] ?? '';
    const runtime = pyVer ? `Python ${pyVer}` : 'Python';

    // Detect framework
    let framework: string | null = null;
    if (/django/i.test(raw))   framework = 'Django';
    else if (/flask/i.test(raw))    framework = 'Flask';
    else if (/fastapi/i.test(raw))  framework = 'FastAPI';
    else if (/tornado/i.test(raw))  framework = 'Tornado';

    // Detect test runner
    let testRunner: string | null = null;
    if (/pytest/i.test(raw))        testRunner = 'pytest';
    else if (/unittest/i.test(raw)) testRunner = 'unittest';

    // Detect package manager
    let pm = 'pip';
    if (/\[tool\.poetry\]/i.test(raw)) pm = 'poetry';
    if (/\[tool\.hatch\]/i.test(raw))  pm = 'hatch';

    return makeContext({
      runtime,
      framework,
      packageManager: pm,
      buildCommand:   pm === 'poetry' ? 'poetry build' : 'python -m build',
      testCommand:    testRunner === 'pytest' ? 'pytest' : 'python -m pytest',
      installCommand: pm === 'poetry' ? 'poetry install' : 'pip install -e .',
      testRunner,
    });
  } catch {
    return null;
  }
}

// ── Go ─────────────────────────────────────────────────────────────────────────

async function tryParseGoMod(rootPath: string): Promise<RepoContext | null> {
  try {
    const raw = await fs.readFile(path.join(rootPath, 'go.mod'), 'utf8');

    const goVer = (raw.match(/^go\s+([\d.]+)/m) ?? [])[1] ?? '';
    const runtime = goVer ? `Go ${goVer}` : 'Go';

    // Detect framework from imports in go.mod
    let framework: string | null = null;
    if (/gin-gonic\/gin/i.test(raw))        framework = 'Gin';
    else if (/labstack\/echo/i.test(raw))   framework = 'Echo';
    else if (/gofiber\/fiber/i.test(raw))   framework = 'Fiber';
    else if (/gorilla\/mux/i.test(raw))     framework = 'Gorilla Mux';

    return makeContext({
      runtime,
      framework,
      packageManager: 'go',
      buildCommand:   'go build ./...',
      testCommand:    'go test ./...',
      installCommand: 'go mod download',
      testRunner:     'go-test',
    });
  } catch {
    return null;
  }
}

// ── Rust ───────────────────────────────────────────────────────────────────────

async function tryParseCargoToml(rootPath: string): Promise<RepoContext | null> {
  try {
    const raw = await fs.readFile(path.join(rootPath, 'Cargo.toml'), 'utf8');

    // Detect edition
    const edition = (raw.match(/edition\s*=\s*["'](\d+)["']/) ?? [])[1] ?? '';
    const runtime = edition ? `Rust (${edition} edition)` : 'Rust';

    // Detect framework
    let framework: string | null = null;
    if (/actix-web/i.test(raw))       framework = 'Actix Web';
    else if (/axum/i.test(raw))       framework = 'Axum';
    else if (/rocket/i.test(raw))     framework = 'Rocket';
    else if (/warp/i.test(raw))       framework = 'Warp';

    return makeContext({
      runtime,
      framework,
      packageManager: 'cargo',
      buildCommand:   'cargo build',
      testCommand:    'cargo test',
      installCommand: 'cargo fetch',
      testRunner:     'cargo-test',
    });
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeContext(fields: Omit<RepoContext, 'formatForPrompt'>): RepoContext {
  return {
    ...fields,
    formatForPrompt(): string {
      const lines: string[] = [
        '## Repository environment (detected automatically)',
        '',
        `- **Runtime:**         ${this.runtime}`,
      ];
      if (this.framework) {
        lines.push(`- **Framework:**        ${this.framework}`);
      }
      lines.push(
        `- **Package manager:** ${this.packageManager}`,
        `- **Build command:**   \`${this.buildCommand}\``,
        `- **Test command:**    \`${this.testCommand}\``,
        `- **Install command:** \`${this.installCommand}\``,
      );
      if (this.testRunner) {
        lines.push(`- **Test runner:**      ${this.testRunner}`);
      }
      lines.push(
        '',
        'Use these exact commands in verify and test nodes — do not substitute generic alternatives.',
      );
      return lines.join('\n');
    },
  };
}
