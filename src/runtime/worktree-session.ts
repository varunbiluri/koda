/**
 * WorktreeSession — user-facing worktree mode for the Koda REPL.
 *
 * Claude Code pattern: enter an isolated git worktree, work there, then
 * merge or discard back to the main tree.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { WorktreeManager, type GitWorktreeEntry } from './worktree-manager.js';
import { logger } from '../utils/logger.js';

const SESSION_FILE = path.join('.koda', 'active-worktree.json');
const DEFAULT_TASK = 'session';

export interface ActiveWorktree {
  taskName:     string;
  worktreePath: string;
  branchName:   string;
  mainRoot:     string;
  enteredAt:    number;
}

export class WorktreeSession {
  private readonly wm: WorktreeManager;
  private active: ActiveWorktree | null = null;

  private constructor(private readonly mainRoot: string) {
    this.wm = new WorktreeManager(mainRoot);
  }

  static async load(mainRoot: string): Promise<WorktreeSession> {
    const session = new WorktreeSession(mainRoot);
    await session.restore();
    return session;
  }

  getMainRoot(): string {
    return this.mainRoot;
  }

  /** Directory agents and tools should use (worktree when active). */
  getEffectiveRoot(): string {
    return this.active?.worktreePath ?? this.mainRoot;
  }

  isActive(): boolean {
    return this.active !== null;
  }

  getActive(): ActiveWorktree | null {
    return this.active ? { ...this.active } : null;
  }

  /** Create and enter an isolated worktree for this REPL session. */
  async enter(taskName = DEFAULT_TASK): Promise<ActiveWorktree> {
    if (this.active) {
      throw new Error(
        'Already in a worktree. Run /worktree merge or /worktree discard first.',
      );
    }

    const worktreePath = await this.wm.createWorktree(taskName);
    const branchName   = this.wm.getBranchName(taskName);
    if (!branchName) {
      throw new Error('Worktree created but branch name missing');
    }

    this.active = {
      taskName,
      worktreePath,
      branchName,
      mainRoot: this.mainRoot,
      enteredAt: Date.now(),
    };
    await this.persist();
    logger.debug(`[worktree-session] Entered ${worktreePath} on ${branchName}`);
    return { ...this.active };
  }

  /** Merge active worktree branch into main and exit worktree mode. */
  async merge(): Promise<ActiveWorktree> {
    if (!this.active) {
      throw new Error('Not in a worktree. Run /worktree enter first.');
    }
    const snapshot = { ...this.active };
    await this.wm.mergeWorktree(this.active.taskName);
    this.active = null;
    await this.clearPersist();
    return snapshot;
  }

  /** Discard active worktree without merging. */
  async discard(): Promise<ActiveWorktree> {
    if (!this.active) {
      throw new Error('Not in a worktree. Run /worktree enter first.');
    }
    const snapshot = { ...this.active };
    await this.wm.removeWorktree(this.active.taskName);
    this.active = null;
    await this.clearPersist();
    return snapshot;
  }

  /** List all git worktrees for this repository. */
  async list(): Promise<GitWorktreeEntry[]> {
    return this.wm.listGitWorktrees();
  }

  private async restore(): Promise<void> {
    const file = path.join(this.mainRoot, SESSION_FILE);
    try {
      const raw   = await fs.readFile(file, 'utf8');
      const saved = JSON.parse(raw) as ActiveWorktree;
      if (saved.mainRoot !== this.mainRoot) return;
      await fs.access(saved.worktreePath);
      this.wm.adopt(saved.taskName, saved.worktreePath, saved.branchName);
      this.active = saved;
      logger.debug(`[worktree-session] Restored active worktree ${saved.worktreePath}`);
    } catch {
      this.active = null;
    }
  }

  private async persist(): Promise<void> {
    if (!this.active) return;
    const file = path.join(this.mainRoot, SESSION_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(this.active, null, 2) + '\n', 'utf8');
  }

  private async clearPersist(): Promise<void> {
    try {
      await fs.unlink(path.join(this.mainRoot, SESSION_FILE));
    } catch {
      // ignore
    }
  }
}
