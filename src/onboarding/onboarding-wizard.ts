/**
 * OnboardingWizard — first-run experience for new Koda users.
 *
 * Activates on the first `koda init` in a repository (no .koda/config.json yet).
 *
 * Flow:
 *   1. Detect repo type (Node, Python, Go, Rust, unknown)
 *   2. Show what Koda found (files, entry points, test runner)
 *   3. Explain three primary capabilities
 *   4. Suggest the first task based on repo type
 *   5. Show 3 example commands the user can run right now
 *
 * Part 5 — Onboarding (product mission).
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RepoProfile {
  runtime:     string;
  framework:   string;
  testRunner:  string;
  entryPoint:  string;
  fileCount:   number;
}

// ── OnboardingWizard ───────────────────────────────────────────────────────────

export class OnboardingWizard {
  private readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  // ── Factory check ──────────────────────────────────────────────────────────

  /** Returns true if this is the user's first koda init in this repo. */
  static async isFirstRun(rootPath: string): Promise<boolean> {
    const flagFile = path.join(rootPath, '.koda', 'onboarded');
    try {
      await fs.access(flagFile);
      return false;
    } catch {
      return true;
    }
  }

  /** Mark the repo as onboarded so the wizard doesn't run again. */
  static async markOnboarded(rootPath: string): Promise<void> {
    const dir = path.join(rootPath, '.koda');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'onboarded'), new Date().toISOString(), 'utf8');
  }

  // ── Profile detection ──────────────────────────────────────────────────────

  async detectProfile(fileCount: number): Promise<RepoProfile> {
    const root = this.rootPath;

    // Runtime detection
    let runtime    = 'unknown';
    let framework  = 'unknown';
    let testRunner = 'unknown';
    let entryPoint = 'src/index.ts';

    const [hasPkg, hasPyproj, hasGoMod, hasCargo] = await Promise.all([
      exists(path.join(root, 'package.json')),
      exists(path.join(root, 'pyproject.toml')),
      exists(path.join(root, 'go.mod')),
      exists(path.join(root, 'Cargo.toml')),
    ]);

    if (hasPkg) {
      runtime = 'Node.js';
      entryPoint = 'src/index.ts';
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['vitest'])   testRunner = 'vitest';
        else if (deps['jest']) testRunner = 'jest';
        else if (deps['mocha']) testRunner = 'mocha';
        if (deps['express'] || deps['fastify']) framework = 'Express/Fastify';
        else if (deps['next'])   framework = 'Next.js';
        else if (deps['react'])  framework = 'React';
        else if (deps['vue'])    framework = 'Vue';
        else if (deps['nestjs']) framework = 'NestJS';
      } catch { /* use defaults */ }
    } else if (hasPyproj) {
      runtime    = 'Python';
      framework  = 'FastAPI/Django';
      testRunner = 'pytest';
      entryPoint = 'main.py';
    } else if (hasGoMod) {
      runtime    = 'Go';
      framework  = 'stdlib';
      testRunner = 'go test';
      entryPoint = 'main.go';
    } else if (hasCargo) {
      runtime    = 'Rust';
      framework  = 'stdlib';
      testRunner = 'cargo test';
      entryPoint = 'src/main.rs';
    }

    return { runtime, framework, testRunner, entryPoint, fileCount };
  }

  // ── Welcome display ────────────────────────────────────────────────────────

  async printWelcome(profile: RepoProfile): Promise<void> {
    const w = chalk.bold.white;
    const g = chalk.green;
    const c = chalk.cyan;
    const d = chalk.gray;
    const y = chalk.yellow;

    console.log();
    console.log(chalk.bold.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.blue('  Welcome to Koda — your autonomous engineer'));
    console.log(chalk.bold.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log();

    // What Koda found
    console.log(w('  What I found:'));
    console.log(`    Runtime:     ${g(profile.runtime)}`);
    if (profile.framework !== 'unknown') {
      console.log(`    Framework:   ${g(profile.framework)}`);
    }
    if (profile.testRunner !== 'unknown') {
      console.log(`    Tests:       ${g(profile.testRunner)}`);
    }
    console.log(`    Files:       ${g(String(profile.fileCount))} indexed`);
    console.log();

    // 3 primary capabilities
    console.log(w('  What I can do:'));
    console.log(`    ${g('①')}  Fix bugs — describe the problem, I find the cause and patch it`);
    console.log(`    ${g('②')}  Add features — describe what you need, I plan, implement, and verify`);
    console.log(`    ${g('③')}  Refactor — point me at a module, I restructure it safely`);
    console.log();

    // How Koda is different
    console.log(w('  Why Koda is different:'));
    console.log(`    ${c('→')}  I ${y('execute')} tasks — not just suggest them`);
    console.log(`    ${c('→')}  I ${y('fix my own mistakes')} — autonomous retry with verification`);
    console.log(`    ${c('→')}  I ${y('learn from this repo')} — gets smarter each session`);
    console.log();

    // First task suggestion
    const suggestion = this._suggestFirstTask(profile);
    console.log(w('  Suggested first task:'));
    console.log(`    ${chalk.bold.yellow('$')} ${suggestion}`);
    console.log();

    // Quick reference
    console.log(w('  Quick reference:'));
    console.log(`    ${d('koda fix  "<bug>"')}      — fix a bug autonomously`);
    console.log(`    ${d('koda add  "<feature>"')}  — add a feature`);
    console.log(`    ${d('koda ask  "<question>"')} — ask about the codebase`);
    console.log(`    ${d('koda auto "<task>"')}     — fully autonomous mode`);
    console.log(`    ${d('koda doctor')}            — diagnose any issues`);
    console.log();
    console.log(chalk.bold.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _suggestFirstTask(profile: RepoProfile): string {
    const suggestions: Record<string, string> = {
      'Node.js': 'koda ask "What are the main modules in this codebase?"',
      'Python':  'koda ask "How is the application structured?"',
      'Go':      'koda ask "What does the main package do?"',
      'Rust':    'koda ask "What are the top-level modules?"',
      'unknown': 'koda ask "Give me an overview of this codebase"',
    };
    return suggestions[profile.runtime] ?? suggestions['unknown'];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; }
  catch { return false; }
}
