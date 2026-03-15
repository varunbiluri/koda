import * as path from 'node:path';
import * as fs   from 'node:fs/promises';
import { CommandExecutor } from './command-executor.js';
import { logger } from '../utils/logger.js';

// ── WorktreeManager ───────────────────────────────────────────────────────────

/**
 * WorktreeManager — creates and manages isolated git worktrees for task
 * execution.
 *
 * Each task gets its own worktree at `.koda/worktrees/{taskName}` on a fresh
 * branch `feature/koda-{timestamp}`.  On success the branch is merged back;
 * on failure the worktree is simply removed, leaving the main tree clean.
 */
export class WorktreeManager {
  private executor: CommandExecutor;
  /** Map of taskName → { worktreePath, branchName } for managed worktrees. */
  private worktrees: Map<string, { worktreePath: string; branchName: string }> =
    new Map();

  constructor(private readonly rootPath: string) {
    this.executor = new CommandExecutor(rootPath);
  }

  // ── Core API ───────────────────────────────────────────────────────────────

  /**
   * Create an isolated git worktree for a task.
   *
   * Steps:
   *   1. Generate a unique branch name `feature/koda-{timestamp}`.
   *   2. Ensure the `.koda/worktrees/` directory exists.
   *   3. Run `git worktree add <path> -b <branch>`.
   *   4. Register the worktree in the internal map.
   *
   * @returns Absolute path to the new worktree directory.
   */
  async createWorktree(taskName: string): Promise<string> {
    const branchName    = `feature/koda-${Date.now()}`;
    const worktreeDir   = path.join(this.rootPath, '.koda', 'worktrees', taskName);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(worktreeDir), { recursive: true });

    // Remove any stale entry for the same taskName first
    if (this.worktrees.has(taskName)) {
      await this.removeWorktree(taskName).catch(() => {/* ignore cleanup errors */});
    }

    logger.debug(`[worktree] Creating worktree for "${taskName}" at ${worktreeDir} on branch ${branchName}`);

    const result = await this.executor.run(
      `git worktree add "${worktreeDir}" -b "${branchName}"`,
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to create worktree for "${taskName}": ${result.stderr.trim()}`,
      );
    }

    this.worktrees.set(taskName, { worktreePath: worktreeDir, branchName });
    logger.debug(`[worktree] Created worktree for "${taskName}" → ${worktreeDir}`);
    return worktreeDir;
  }

  /**
   * Remove a worktree (used on failure or explicit cleanup).
   *
   * Runs `git worktree remove --force` then deletes the branch if it exists.
   */
  async removeWorktree(taskName: string): Promise<void> {
    const entry = this.worktrees.get(taskName);
    if (!entry) {
      logger.debug(`[worktree] No worktree registered for "${taskName}" — skipping remove`);
      return;
    }

    const { worktreePath, branchName } = entry;
    logger.debug(`[worktree] Removing worktree "${taskName}" at ${worktreePath}`);

    // Remove the worktree checkout
    await this.executor.run(`git worktree remove --force "${worktreePath}"`);

    // Clean up the branch (best-effort — ignore if already deleted)
    await this.executor.run(`git branch -D "${branchName}"`).catch(() => {/* ignore */});

    this.worktrees.delete(taskName);
  }

  /**
   * Merge a worktree branch back into the current HEAD.
   *
   * Strategy: fast-forward only if possible, else regular merge with a
   * descriptive commit message.  The worktree is removed afterwards.
   */
  async mergeWorktree(taskName: string): Promise<void> {
    const entry = this.worktrees.get(taskName);
    if (!entry) {
      throw new Error(`No worktree registered for task "${taskName}"`);
    }

    const { branchName, worktreePath } = entry;
    logger.debug(`[worktree] Merging branch "${branchName}" into HEAD`);

    // Attempt fast-forward first
    const ffResult = await this.executor.run(`git merge --ff-only "${branchName}"`);

    if (ffResult.exitCode !== 0) {
      // Fall back to regular merge
      const mergeResult = await this.executor.run(
        `git merge --no-ff "${branchName}" -m "chore: merge koda task '${taskName}'"`,
      );
      if (mergeResult.exitCode !== 0) {
        throw new Error(
          `Failed to merge worktree branch "${branchName}": ${mergeResult.stderr.trim()}`,
        );
      }
    }

    // Remove the worktree now that it's merged
    await this.executor.run(`git worktree remove --force "${worktreePath}"`);
    await this.executor.run(`git branch -D "${branchName}"`).catch(() => {/* ignore */});
    this.worktrees.delete(taskName);

    logger.debug(`[worktree] Merged and removed worktree for "${taskName}"`);
  }

  /**
   * Remove all managed worktrees (called on process shutdown or error recovery).
   */
  async cleanup(): Promise<void> {
    const taskNames = Array.from(this.worktrees.keys());
    logger.debug(`[worktree] Cleaning up ${taskNames.length} worktree(s)`);
    for (const taskName of taskNames) {
      await this.removeWorktree(taskName).catch((err) =>
        logger.warn(`[worktree] cleanup error for "${taskName}": ${(err as Error).message}`),
      );
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /** Return the absolute worktree path for a task, or undefined if not found. */
  getWorktreePath(taskName: string): string | undefined {
    return this.worktrees.get(taskName)?.worktreePath;
  }

  /** Return the branch name for a task, or undefined if not found. */
  getBranchName(taskName: string): string | undefined {
    return this.worktrees.get(taskName)?.branchName;
  }

  /** All currently managed task names. */
  getManagedTasks(): string[] {
    return Array.from(this.worktrees.keys());
  }
}
