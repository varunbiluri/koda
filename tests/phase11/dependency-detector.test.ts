import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DependencyDetector, detectDependencies } from '../../src/analysis/dependency-detector.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-deps-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Node / TypeScript detection ───────────────────────────────────────────────

describe('Node package.json detection', () => {
  it('detects typescript language', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { typescript: '^5.0.0' }, devDependencies: {} }),
    );
    const result = await detectDependencies(tmpDir);
    expect(result.language).toBe('typescript');
  });

  it('detects javascript when no typescript present', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    );
    const result = await detectDependencies(tmpDir);
    expect(result.language).toBe('javascript');
  });

  it('detects next.js framework', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0', react: '^18.0.0' } }),
    );
    const result = await detectDependencies(tmpDir);
    expect(result.framework).toBe('next.js');
  });

  it('detects express framework', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    );
    const result = await detectDependencies(tmpDir);
    expect(result.framework).toBe('express');
  });

  it('detects vitest test framework', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' } }),
    );
    const result = await detectDependencies(tmpDir);
    expect(result.testFramework).toBe('vitest');
  });

  it('detects jest test framework', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { jest: '^29.0.0' } }),
    );
    const result = await detectDependencies(tmpDir);
    expect(result.testFramework).toBe('jest');
  });

  it('detects vite build tool from scripts', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        scripts: { build: 'vite build' },
        devDependencies: { vite: '^5.0.0' },
      }),
    );
    const result = await detectDependencies(tmpDir);
    expect(result.buildTool).toBe('vite');
  });

  it('detects pnpm from lockfile', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: {} }));
    await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const result = await detectDependencies(tmpDir);
    expect(result.packageManager).toBe('pnpm');
  });

  it('reads packageManager field', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ packageManager: 'yarn@4.0.0', dependencies: {} }),
    );
    const result = await detectDependencies(tmpDir);
    expect(result.packageManager).toBe('yarn');
  });

  it('populates topDependencies', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.0.0', lodash: '^4.0.0' } }),
    );
    const result = await detectDependencies(tmpDir);
    expect(result.topDependencies).toContain('express');
    expect(result.topDependencies).toContain('lodash');
  });
});

// ── Python detection ──────────────────────────────────────────────────────────

describe('Python detection', () => {
  it('detects python from requirements.txt', async () => {
    await fs.writeFile(path.join(tmpDir, 'requirements.txt'), 'fastapi>=0.100\nuvicorn\n');
    const result = await detectDependencies(tmpDir);
    expect(result.language).toBe('python');
    expect(result.framework).toBe('fastapi');
  });

  it('detects django from requirements.txt', async () => {
    await fs.writeFile(path.join(tmpDir, 'requirements.txt'), 'Django>=4.0\npsycopg2\n');
    const result = await detectDependencies(tmpDir);
    expect(result.framework).toBe('django');
  });

  it('detects pytest test framework', async () => {
    await fs.writeFile(path.join(tmpDir, 'requirements.txt'), 'pytest>=7.0\nfastapi\n');
    const result = await detectDependencies(tmpDir);
    expect(result.testFramework).toBe('pytest');
  });
});

// ── Java detection ────────────────────────────────────────────────────────────

describe('Java / Maven detection', () => {
  it('detects java from pom.xml', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'pom.xml'),
      '<project><dependencies><dependency>spring-boot</dependency></dependencies></project>',
    );
    const result = await detectDependencies(tmpDir);
    expect(result.language).toBe('java');
    expect(result.buildTool).toBe('maven');
    expect(result.framework).toBe('spring-boot');
  });

  it('detects junit from pom.xml', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'pom.xml'),
      '<project><dependencies><dependency>junit</dependency></dependencies></project>',
    );
    const result = await detectDependencies(tmpDir);
    expect(result.testFramework).toBe('junit');
  });
});

// ── Fallback ──────────────────────────────────────────────────────────────────

describe('fallback for unknown project', () => {
  it('returns unknown language when no config files found', async () => {
    const result = await detectDependencies(tmpDir);
    expect(result.language).toBe('unknown');
    expect(result.framework).toBeNull();
    expect(result.topDependencies).toHaveLength(0);
  });
});

// ── DependencyDetector class API ──────────────────────────────────────────────

describe('DependencyDetector class', () => {
  it('detect() returns same result as module-level detectDependencies()', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    );
    const fromClass = await new DependencyDetector(tmpDir).detect();
    const fromFn = await detectDependencies(tmpDir);
    expect(fromClass).toEqual(fromFn);
  });
});
