import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ProjectDependencies {
  language: string;
  framework: string | null;
  testFramework: string | null;
  buildTool: string | null;
  packageManager: string | null;
  /** Raw list of top-level production dependencies (first 30). */
  topDependencies: string[];
}

// ── Detection tables ──────────────────────────────────────────────────────────

const JS_FRAMEWORK_PATTERNS: Array<{ match: RegExp; name: string }> = [
  { match: /^next$/, name: 'next.js' },
  { match: /^nuxt/, name: 'nuxt' },
  { match: /^@angular\/core$/, name: 'angular' },
  { match: /^vue$/, name: 'vue' },
  { match: /^svelte$/, name: 'svelte' },
  { match: /^express$/, name: 'express' },
  { match: /^fastify$/, name: 'fastify' },
  { match: /^@nestjs\/core$/, name: 'nestjs' },
  { match: /^hono$/, name: 'hono' },
  { match: /^koa$/, name: 'koa' },
  { match: /^react$/, name: 'react' },
];

const JS_TEST_PATTERNS: Array<{ match: RegExp; name: string }> = [
  { match: /^vitest$/, name: 'vitest' },
  { match: /^jest$/, name: 'jest' },
  { match: /^mocha$/, name: 'mocha' },
  { match: /^jasmine$/, name: 'jasmine' },
  { match: /^@playwright\/test$/, name: 'playwright' },
  { match: /^cypress$/, name: 'cypress' },
];

const PYTHON_FRAMEWORK_PATTERNS: Array<{ match: RegExp; name: string }> = [
  { match: /^fastapi/, name: 'fastapi' },
  { match: /^django/, name: 'django' },
  { match: /^flask/, name: 'flask' },
  { match: /^tornado/, name: 'tornado' },
  { match: /^starlette/, name: 'starlette' },
];

const PYTHON_TEST_PATTERNS: Array<{ match: RegExp; name: string }> = [
  { match: /^pytest/, name: 'pytest' },
  { match: /^unittest/, name: 'unittest' },
  { match: /^nose2?/, name: 'nose' },
];

// ── DependencyDetector ────────────────────────────────────────────────────────

/**
 * DependencyDetector — reads standard config files to identify the language,
 * framework, test runner, and build tooling of a project.
 *
 * Supported ecosystems:
 *   • Node / TypeScript: package.json
 *   • Python: requirements.txt, pyproject.toml
 *   • Java/Kotlin: pom.xml, build.gradle
 */
export class DependencyDetector {
  constructor(private readonly rootPath: string) {}

  async detect(): Promise<ProjectDependencies> {
    const results = await Promise.allSettled([
      this.detectNode(),
      this.detectPython(),
      this.detectJava(),
    ]);

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value !== null) return r.value;
    }

    return {
      language: 'unknown',
      framework: null,
      testFramework: null,
      buildTool: null,
      packageManager: null,
      topDependencies: [],
    };
  }

  // ── Node / TypeScript ───────────────────────────────────────────────────────

  private async detectNode(): Promise<ProjectDependencies | null> {
    const pkgPath = path.join(this.rootPath, 'package.json');
    let pkg: Record<string, unknown>;
    try {
      const raw = await fs.readFile(pkgPath, 'utf-8');
      pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }

    const deps: Record<string, string> = {
      ...(pkg['dependencies'] as Record<string, string> ?? {}),
      ...(pkg['devDependencies'] as Record<string, string> ?? {}),
    };
    const depNames = Object.keys(deps);

    const language = depNames.some((d) => /^typescript$|@types\//.test(d))
      ? 'typescript'
      : 'javascript';

    const framework = matchFirst(depNames, JS_FRAMEWORK_PATTERNS);
    const testFramework = matchFirst(depNames, JS_TEST_PATTERNS);

    // Build tool: prefer packageManager field, then scripts, then lockfile heuristics
    let buildTool: string | null = null;
    if (pkg['scripts']) {
      const scripts = pkg['scripts'] as Record<string, string>;
      if (Object.values(scripts).some((v) => v.includes('tsc '))) buildTool = 'tsc';
      if (Object.values(scripts).some((v) => v.includes('vite '))) buildTool = 'vite';
      if (Object.values(scripts).some((v) => v.includes('esbuild '))) buildTool = 'esbuild';
      if (Object.values(scripts).some((v) => v.includes('rollup '))) buildTool = 'rollup';
      if (Object.values(scripts).some((v) => v.includes('webpack '))) buildTool = 'webpack';
    }

    // Package manager
    let packageManager: string | null = null;
    if (typeof pkg['packageManager'] === 'string') {
      packageManager = (pkg['packageManager'] as string).split('@')[0] ?? null;
    } else {
      // Detect from lockfiles
      const [hasPnpm, hasYarn, hasBun] = await Promise.all([
        fileExists(path.join(this.rootPath, 'pnpm-lock.yaml')),
        fileExists(path.join(this.rootPath, 'yarn.lock')),
        fileExists(path.join(this.rootPath, 'bun.lockb')),
      ]);
      if (hasPnpm) packageManager = 'pnpm';
      else if (hasBun) packageManager = 'bun';
      else if (hasYarn) packageManager = 'yarn';
      else packageManager = 'npm';
    }

    return {
      language,
      framework,
      testFramework,
      buildTool,
      packageManager,
      topDependencies: depNames.slice(0, 30),
    };
  }

  // ── Python ─────────────────────────────────────────────────────────────────

  private async detectPython(): Promise<ProjectDependencies | null> {
    const [reqExists, pyprojectExists] = await Promise.all([
      fileExists(path.join(this.rootPath, 'requirements.txt')),
      fileExists(path.join(this.rootPath, 'pyproject.toml')),
    ]);

    if (!reqExists && !pyprojectExists) return null;

    const depNames: string[] = [];

    if (reqExists) {
      const raw = await fs.readFile(path.join(this.rootPath, 'requirements.txt'), 'utf-8');
      depNames.push(
        ...raw
          .split('\n')
          .map((l) => l.trim().split(/[=<>!~]/)[0].toLowerCase())
          .filter(Boolean),
      );
    }

    if (pyprojectExists) {
      // Simple toml scan — no full parser needed
      const raw = await fs.readFile(path.join(this.rootPath, 'pyproject.toml'), 'utf-8');
      const matches = raw.matchAll(/"([a-zA-Z0-9_-]+)\s*[>=<!]/g);
      for (const m of matches) depNames.push(m[1].toLowerCase());
    }

    return {
      language: 'python',
      framework: matchFirst(depNames, PYTHON_FRAMEWORK_PATTERNS),
      testFramework: matchFirst(depNames, PYTHON_TEST_PATTERNS),
      buildTool: depNames.includes('poetry') ? 'poetry' : depNames.includes('hatch') ? 'hatch' : null,
      packageManager: pyprojectExists ? 'pip/poetry' : 'pip',
      topDependencies: depNames.slice(0, 30),
    };
  }

  // ── Java / Kotlin ──────────────────────────────────────────────────────────

  private async detectJava(): Promise<ProjectDependencies | null> {
    const [pomExists, gradleExists] = await Promise.all([
      fileExists(path.join(this.rootPath, 'pom.xml')),
      fileExists(path.join(this.rootPath, 'build.gradle')),
    ]);

    if (!pomExists && !gradleExists) return null;

    const buildTool = gradleExists ? 'gradle' : 'maven';
    let framework: string | null = null;
    let testFramework: string | null = null;

    try {
      const buildFile = gradleExists
        ? await fs.readFile(path.join(this.rootPath, 'build.gradle'), 'utf-8')
        : await fs.readFile(path.join(this.rootPath, 'pom.xml'), 'utf-8');

      if (/spring-boot|springframework/i.test(buildFile)) framework = 'spring-boot';
      if (/micronaut/i.test(buildFile)) framework = 'micronaut';
      if (/quarkus/i.test(buildFile)) framework = 'quarkus';
      if (/junit/i.test(buildFile)) testFramework = 'junit';
      if (/testng/i.test(buildFile)) testFramework = 'testng';
    } catch {
      // best-effort
    }

    return {
      language: 'java',
      framework,
      testFramework,
      buildTool,
      packageManager: buildTool,
      topDependencies: [],
    };
  }
}

// ── Module-level convenience function ────────────────────────────────────────

/**
 * Detect project dependencies for a repository root.
 * Returns a sensible default if detection fails.
 */
export async function detectDependencies(rootPath: string): Promise<ProjectDependencies> {
  return new DependencyDetector(rootPath).detect();
}

// ── Private utils ─────────────────────────────────────────────────────────────

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function matchFirst(
  deps: string[],
  patterns: Array<{ match: RegExp; name: string }>,
): string | null {
  for (const dep of deps) {
    for (const { match, name } of patterns) {
      if (match.test(dep)) return name;
    }
  }
  return null;
}
