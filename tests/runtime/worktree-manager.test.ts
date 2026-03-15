/**
 * Tests for WorktreeManager.
 *
 * All git and filesystem operations are mocked so tests run without a real git
 * repository.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeManager } from '../../src/runtime/worktree-manager.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Shared mock function so tests can override behaviour per-test
const runMock = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

vi.mock('../../src/runtime/command-executor.js', () => {
  class CommandExecutor {
    run = runMock;
  }
  return { CommandExecutor };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorktreeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createWorktree() returns an absolute path inside .koda/worktrees/', async () => {
    const wm   = new WorktreeManager('/repo');
    const p    = await wm.createWorktree('my-task');
    expect(p).toContain('.koda/worktrees/my-task');
    expect(p).toMatch(/^\/repo/);
  });

  it('createWorktree() records the task in getManagedTasks()', async () => {
    const wm = new WorktreeManager('/repo');
    await wm.createWorktree('task-a');
    expect(wm.getManagedTasks()).toContain('task-a');
  });

  it('getWorktreePath() returns the registered path', async () => {
    const wm = new WorktreeManager('/repo');
    const p  = await wm.createWorktree('task-b');
    expect(wm.getWorktreePath('task-b')).toBe(p);
  });

  it('getBranchName() returns a feature/koda-* branch', async () => {
    const wm = new WorktreeManager('/repo');
    await wm.createWorktree('task-c');
    const branch = wm.getBranchName('task-c');
    expect(branch).toMatch(/^feature\/koda-\d+$/);
  });

  it('removeWorktree() removes the task from getManagedTasks()', async () => {
    const wm = new WorktreeManager('/repo');
    await wm.createWorktree('task-d');
    await wm.removeWorktree('task-d');
    expect(wm.getManagedTasks()).not.toContain('task-d');
  });

  it('removeWorktree() is a no-op for an unregistered task', async () => {
    const wm = new WorktreeManager('/repo');
    await expect(wm.removeWorktree('nonexistent')).resolves.toBeUndefined();
  });

  it('mergeWorktree() throws for an unregistered task', async () => {
    const wm = new WorktreeManager('/repo');
    await expect(wm.mergeWorktree('ghost')).rejects.toThrow(/No worktree registered/);
  });

  it('mergeWorktree() removes the task after success', async () => {
    const wm = new WorktreeManager('/repo');
    await wm.createWorktree('task-e');
    await wm.mergeWorktree('task-e');
    expect(wm.getManagedTasks()).not.toContain('task-e');
  });

  it('cleanup() removes all managed worktrees', async () => {
    const wm = new WorktreeManager('/repo');
    await wm.createWorktree('t1');
    await wm.createWorktree('t2');
    await wm.cleanup();
    expect(wm.getManagedTasks()).toHaveLength(0);
  });

  it('createWorktree() throws when git command fails', async () => {
    // Override the shared mock to return a failure for this test
    runMock.mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'fatal: already exists' });

    const wm = new WorktreeManager('/repo');
    await expect(wm.createWorktree('fail-task')).rejects.toThrow('Failed to create worktree');
  });
});
