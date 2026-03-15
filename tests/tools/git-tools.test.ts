import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock terminal-tools so no real git commands run
vi.mock('../../src/tools/terminal-tools.js', () => ({
  runTerminal: vi.fn(),
}));

import { runTerminal } from '../../src/tools/terminal-tools.js';
import {
  gitAdd,
  gitCommit,
  gitPush,
  gitCreatePr,
  gitBranch,
  gitStatus,
  gitDiff,
  gitLog,
  createKodaCommit,
  KODA_CO_AUTHOR_TRAILER,
  KODA_AUTHOR,
} from '../../src/tools/git-tools.js';

const mockRun = runTerminal as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockRun.mockResolvedValue({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } });
});

describe('gitAdd', () => {
  it('runs git add with the provided file path', async () => {
    const result = await gitAdd('src/app.ts', '/repo');
    expect(result.success).toBe(true);
    expect(mockRun).toHaveBeenCalledWith('git add "src/app.ts"', '/repo');
  });

  it('returns failure when command fails', async () => {
    mockRun.mockResolvedValue({ success: false, error: 'not a git repo' });
    const result = await gitAdd('src/app.ts', '/repo');
    expect(result.success).toBe(false);
    expect(result.error).toBe('not a git repo');
  });
});

describe('gitCommit', () => {
  it('runs git commit with the message', async () => {
    mockRun.mockResolvedValue({
      success: true,
      data: { stdout: '[main abc123] fix: auth', stderr: '', exitCode: 0 },
    });
    const result = await gitCommit('fix: auth', '/repo');
    expect(result.success).toBe(true);
    expect(result.data).toContain('fix: auth');
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('git commit -m'),
      '/repo',
    );
  });

  it('escapes double quotes in the commit message', async () => {
    await gitCommit('say "hello"', '/repo');
    const cmd = mockRun.mock.calls[0][0] as string;
    expect(cmd).toContain('\\"hello\\"');
  });
});

describe('gitPush', () => {
  it('runs git push with the branch name', async () => {
    mockRun.mockResolvedValue({
      success: true,
      data: { stdout: 'To github.com:...', stderr: '', exitCode: 0 },
    });
    const result = await gitPush('feature/auth', '/repo');
    expect(result.success).toBe(true);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('git push origin'),
      '/repo',
    );
  });

  it('strips unsafe characters from the branch name', async () => {
    await gitPush('feat/ok; rm -rf /', '/repo');
    const cmd = mockRun.mock.calls[0][0] as string;
    // Semicolons and shell-injection chars must be stripped from the branch arg
    expect(cmd).not.toContain(';');
    expect(cmd).not.toContain('rm -rf');
    // The sanitized branch (feat/okrm-rf/) must appear in the command
    expect(cmd).toContain('feat/okrm-rf/');
  });
});

describe('gitCreatePr', () => {
  it('calls gh pr create with title and body', async () => {
    mockRun.mockResolvedValue({
      success: true,
      data: { stdout: 'https://github.com/org/repo/pull/42', stderr: '', exitCode: 0 },
    });
    const result = await gitCreatePr('Add feature', 'Detailed description', '/repo');
    expect(result.success).toBe(true);
    expect(result.data).toContain('pull/42');
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('gh pr create'),
      '/repo',
    );
  });
});

// ── createKodaCommit ──────────────────────────────────────────────────────────

describe('createKodaCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default success responses for: git add, git commit, git rev-parse
    mockRun
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } })   // git add
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } })   // git commit
      .mockResolvedValueOnce({ success: true, data: { stdout: 'abc1234\n', stderr: '', exitCode: 0 } }); // rev-parse
  });

  it('commit message ends with the Co-authored-by trailer', async () => {
    const result = await createKodaCommit('feat: add login', '/repo');
    expect(result.success).toBe(true);
    expect(result.data!.message).toMatch(/Co-authored-by: Koda AI/);
    expect(result.data!.message.trimEnd()).toMatch(/Co-authored-by:.+@users\.noreply\.github\.com>$/);
  });

  it('co-author trailer uses the correct GitHub noreply email', async () => {
    const result = await createKodaCommit('fix: bug', '/repo');
    expect(result.data!.message).toContain(
      'Co-authored-by: Koda AI <268287658+koda-ai-engineer@users.noreply.github.com>',
    );
  });

  it('co-author trailer is the final line of the commit message', async () => {
    const result = await createKodaCommit('chore: cleanup', '/repo');
    const lines = result.data!.message.split('\n').filter(Boolean);
    expect(lines[lines.length - 1]).toBe(
      'Co-authored-by: Koda AI <268287658+koda-ai-engineer@users.noreply.github.com>',
    );
  });

  it('commit message contains the original message text', async () => {
    const result = await createKodaCommit('feat: implement auth', '/repo');
    expect(result.data!.message).toContain('feat: implement auth');
  });

  it('commit message contains "Generated with help from Koda AI."', async () => {
    const result = await createKodaCommit('docs: update readme', '/repo');
    expect(result.data!.message).toContain('Generated with help from Koda AI.');
  });

  it('does NOT use --author flag (developer remains primary author)', async () => {
    await createKodaCommit('refactor: clean up', '/repo');
    const commitCmd = mockRun.mock.calls[1][0] as string;
    expect(commitCmd).not.toContain('--author');
  });

  it('git commit command is called with -m flag', async () => {
    await createKodaCommit('test: add specs', '/repo');
    const commitCmd = mockRun.mock.calls[1][0] as string;
    expect(commitCmd).toMatch(/^git commit -m/);
  });

  it('returns the short commit hash from rev-parse', async () => {
    const result = await createKodaCommit('feat: something', '/repo');
    expect(result.data!.hash).toBe('abc1234');
  });

  it('stages all files by default (git add .)', async () => {
    await createKodaCommit('fix: typo', '/repo');
    expect(mockRun).toHaveBeenCalledWith('git add "."', '/repo');
  });

  it('stages only specified files when provided', async () => {
    await createKodaCommit('fix: typo', '/repo', ['src/auth.ts', 'src/utils.ts']);
    expect(mockRun).toHaveBeenCalledWith('git add "src/auth.ts" "src/utils.ts"', '/repo');
  });

  it('returns failure when git add fails', async () => {
    mockRun.mockReset();
    mockRun.mockResolvedValueOnce({ success: false, error: 'not a repo' });
    const result = await createKodaCommit('fix', '/repo');
    expect(result.success).toBe(false);
    expect(result.error).toContain('git add failed');
  });

  it('returns failure when git commit fails', async () => {
    mockRun.mockReset();
    mockRun
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } })
      .mockResolvedValueOnce({ success: false, error: 'nothing to commit' });
    const result = await createKodaCommit('empty', '/repo');
    expect(result.success).toBe(false);
    expect(result.error).toContain('git commit failed');
  });
});

// ── KODA_CO_AUTHOR_TRAILER constant ───────────────────────────────────────────

describe('KODA_CO_AUTHOR_TRAILER', () => {
  it('starts with "Co-authored-by:"', () => {
    expect(KODA_CO_AUTHOR_TRAILER).toMatch(/^Co-authored-by:/);
  });

  it('includes the correct noreply email', () => {
    expect(KODA_CO_AUTHOR_TRAILER).toContain('268287658+koda-ai-engineer@users.noreply.github.com');
  });

  it('has no trailing newline', () => {
    expect(KODA_CO_AUTHOR_TRAILER).not.toMatch(/\n$/);
  });
});

// ── KODA_AUTHOR constant ──────────────────────────────────────────────────────

describe('KODA_AUTHOR', () => {
  it('contains the updated noreply email', () => {
    expect(KODA_AUTHOR).toContain('268287658+koda-ai-engineer@users.noreply.github.com');
  });
});

describe('existing git tools still work', () => {
  it('gitBranch returns branch name', async () => {
    mockRun.mockResolvedValue({
      success: true,
      data: { stdout: 'main\n', stderr: '', exitCode: 0 },
    });
    const result = await gitBranch('/repo');
    expect(result.data).toBe('main');
  });

  it('gitStatus returns status output', async () => {
    mockRun.mockResolvedValue({
      success: true,
      data: { stdout: 'M src/app.ts\n', stderr: '', exitCode: 0 },
    });
    const result = await gitStatus('/repo');
    expect(result.success).toBe(true);
    expect(result.data).toContain('src/app.ts');
  });

  it('gitDiff returns diff output', async () => {
    mockRun.mockResolvedValue({
      success: true,
      data: { stdout: '+added line\n-removed line\n', stderr: '', exitCode: 0 },
    });
    const result = await gitDiff('/repo');
    expect(result.success).toBe(true);
    expect(result.data).toContain('+added line');
  });

  it('gitLog returns commit history', async () => {
    mockRun.mockResolvedValue({
      success: true,
      data: { stdout: 'abc123 first commit\n', stderr: '', exitCode: 0 },
    });
    const result = await gitLog(5, '/repo');
    expect(result.success).toBe(true);
    expect(result.data).toContain('first commit');
    expect(mockRun).toHaveBeenCalledWith('git log -5 --oneline', '/repo');
  });
});
