/**
 * koda update — check for latest version and update CLI.
 */

import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { VERSION } from '../../constants.js';
import chalk from 'chalk';

// ── Changelog entries keyed by version ──────────────────────────────────────

const CHANGELOG: Record<string, string[]> = {
  '0.2.1': [
    'Performance improvements — 2× faster indexing',
    'Smarter auto-fix retries with failure classifier',
    'koda feedback command for one-command bug reports',
    'FrictionDetector — catches setup issues before you hit them',
  ],
  '0.2.0': [
    'koda add — autonomous feature implementation',
    'koda auto — general-purpose autonomous task runner',
    'Parallel DAG scheduler — nodes run concurrently',
    'Impact analysis before touching high-dependency files',
  ],
  '0.1.2': [
    'Onboarding wizard for first-time users',
    'Background indexer — incremental re-index on file save',
    'Resource governor — adaptive concurrency under memory pressure',
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchLatestVersion(pkg: string): Promise<string | null> {
  try {
    const result = execSync(`npm view ${pkg} version --json 2>/dev/null`, {
      timeout: 8000,
      encoding: 'utf8',
    }).trim();
    return JSON.parse(result) as string;
  } catch {
    return null;
  }
}

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

function changesBetween(from: string, to: string): string[] {
  const versions = Object.keys(CHANGELOG).filter((v) => semverGt(v, from) && !semverGt(v, to));
  versions.sort((a, b) => (semverGt(a, b) ? -1 : 1));
  return versions.flatMap((v) => CHANGELOG[v] ?? []);
}

function installUpdate(pkg: string): void {
  execSync(`npm install -g ${pkg}`, { stdio: 'inherit', timeout: 60_000 });
}

// ── Command ──────────────────────────────────────────────────────────────────

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Check for the latest version of Koda and update if available')
    .option('--check', 'Only check for updates, do not install')
    .option('--force', 'Reinstall even if already on latest version')
    .action(async (opts: { check?: boolean; force?: boolean }) => {
      const pkg = '@varunbilluri/koda';

      process.stdout.write(chalk.cyan('  Checking for updates…\n'));

      const latest = await fetchLatestVersion(pkg);

      if (!latest) {
        console.log(chalk.yellow('  ⚠ Could not reach npm registry. Check your network connection.'));
        process.exit(0);
      }

      const current = VERSION;
      const hasUpdate = semverGt(latest, current);

      if (!hasUpdate && !opts.force) {
        console.log(chalk.green(`  ✔ Already on the latest version (${current})`));
        process.exit(0);
      }

      if (opts.check) {
        if (hasUpdate) {
          console.log(chalk.cyan(`  ↑ Koda ${latest} is available (you have ${current})`));
          const changes = changesBetween(current, latest);
          if (changes.length) {
            console.log(chalk.gray('\n  What\'s new:'));
            for (const c of changes) {
              console.log(chalk.gray(`    ✔ ${c}`));
            }
          }
          console.log(chalk.gray(`\n  Run ${chalk.white('koda update')} to install.\n`));
        }
        process.exit(0);
      }

      // Perform update
      const label = opts.force ? `Reinstalling Koda ${latest}` : `Updating Koda to ${latest}`;
      console.log(chalk.cyan(`\n  🔄 ${label}…\n`));

      try {
        installUpdate(pkg);
      } catch {
        console.log(chalk.red('\n  ✗ Update failed. Try manually:'));
        console.log(chalk.gray(`    npm install -g ${pkg}\n`));
        process.exit(1);
      }

      console.log(chalk.green(`\n  ✔ Updated to ${latest}`));

      const changes = changesBetween(current, latest);
      if (changes.length) {
        for (const c of changes) {
          console.log(chalk.green(`  ✔ ${c}`));
        }
      }

      console.log(chalk.gray('\n  Restart your terminal to use the new version.\n'));
    });
}
