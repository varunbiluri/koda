/**
 * /worktree slash command — enter, merge, discard, list, clean, status.
 */

import * as path from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import type { UIRenderer } from '../ui-renderer.js';
import type { WorktreeSession } from '../../../runtime/worktree-session.js';
import { WorktreeManager } from '../../../runtime/worktree-manager.js';
import { permissionGate } from '../../../runtime/permission-gate.js';

export function isWorktreeCleanupRequest(input: string): boolean {
  const t = input.trim();
  return (
    /\b(remove|delete|clean|clear|prune|discard)\b.*\b(all\s+)?worktrees?\b/i.test(t) ||
    /\bworktrees?\b.*\b(remove|delete|clean|clear|prune)\b/i.test(t)
  );
}

export async function runWorktreeCleanup(
  mainRoot: string,
  ui: UIRenderer,
  options: { includeClaude?: boolean } = {},
): Promise<void> {
  const wm = new WorktreeManager(mainRoot);
  const markers = options.includeClaude
    ? ['.koda' + path.sep + 'worktrees', '.claude' + path.sep + 'worktrees']
    : ['.koda' + path.sep + 'worktrees'];

  const targets = await wm.listRemovableWorktrees(markers);
  if (targets.length === 0) {
    ui.renderInfo('No stale Koda worktrees to remove.');
    console.log();
    return;
  }

  console.log();
  console.log(chalk.bold('  Worktrees to remove'));
  console.log();
  for (const t of targets) {
    console.log(`  ${chalk.gray('•')} ${chalk.cyan(shortenPath(t.path))} ${chalk.gray(t.branch)}`);
  }
  console.log();

  const scope = options.includeClaude ? 'Koda + Claude worktrees' : 'Koda worktrees (.koda/worktrees)';
  const approved = await permissionGate.requestApproval(
    `remove ${targets.length} ${scope}`,
    'Does not touch your main checkout.',
  );
  if (!approved) {
    ui.renderInfo('Worktree cleanup cancelled.');
    console.log();
    return;
  }

  const removed = await wm.removeWorktreesAt(targets);
  ui.renderInfo(`Removed ${removed.length} worktree${removed.length === 1 ? '' : 's'}.`);
  if (removed.length < targets.length) {
    ui.renderInfo(`${targets.length - removed.length} could not be removed — run \`git worktree list\`.`);
  }
  console.log();
}

export async function runWorktreeCommand(
  args: string[],
  mainRoot: string,
  session: WorktreeSession,
  ui: UIRenderer,
  onContextRootChange: (root: string, branch: string) => void,
): Promise<void> {
  const sub = (args[0] ?? 'status').toLowerCase();

  switch (sub) {
    case 'enter':
    case 'create': {
      const name = args[1] ?? 'session';
      const active = await session.enter(name);
      const branch = getGitBranch(active.worktreePath);
      onContextRootChange(active.worktreePath, branch);
      ui.renderWorktreeEntered(active);
      console.log();
      return;
    }

    case 'merge':
    case 'apply': {
      const merged = await session.merge();
      const branch = getGitBranch(mainRoot);
      onContextRootChange(mainRoot, branch);
      ui.renderWorktreeMerged(merged);
      console.log();
      return;
    }

    case 'discard':
    case 'abort':
    case 'exit': {
      const removed = await session.discard();
      const branch = getGitBranch(mainRoot);
      onContextRootChange(mainRoot, branch);
      ui.renderWorktreeDiscarded(removed);
      console.log();
      return;
    }

    case 'clean':
    case 'prune': {
      const includeClaude = args.includes('--all') || args[1] === 'all';
      await runWorktreeCleanup(mainRoot, ui, { includeClaude });
      return;
    }

    case 'list':
    case 'ls': {
      const entries = await session.list();
      ui.renderWorktreeList(entries, session.getActive());
      console.log();
      return;
    }

    case 'status':
    case 'help':
    default: {
      ui.renderWorktreeHelp(session.getActive());
      console.log();
      return;
    }
  }
}

function shortenPath(p: string): string {
  const home = process.env.HOME ?? '';
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function getGitBranch(cwd: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}
