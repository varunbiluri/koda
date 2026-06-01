import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeSession } from '../../src/runtime/worktree-session.js';

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

const { fsMock } = vi.hoisted(() => ({
  fsMock: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    access: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('node:fs/promises', () => fsMock);

describe('WorktreeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.readFile.mockRejectedValue(new Error('ENOENT'));
  });

  it('starts on main root', async () => {
    const session = await WorktreeSession.load('/repo');
    expect(session.getEffectiveRoot()).toBe('/repo');
    expect(session.isActive()).toBe(false);
  });

  it('enter() creates worktree and switches effective root', async () => {
    const session = await WorktreeSession.load('/repo');
    const active = await session.enter('session');
    expect(active.worktreePath).toContain('.koda/worktrees/session');
    expect(session.getEffectiveRoot()).toBe(active.worktreePath);
    expect(fsMock.writeFile).toHaveBeenCalled();
  });

  it('merge() clears active session', async () => {
    runMock.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    const session = await WorktreeSession.load('/repo');
    await session.enter('session');
    await session.merge();
    expect(session.isActive()).toBe(false);
    expect(session.getEffectiveRoot()).toBe('/repo');
  });

  it('discard() clears active session', async () => {
    const session = await WorktreeSession.load('/repo');
    await session.enter('session');
    await session.discard();
    expect(session.isActive()).toBe(false);
  });
});
