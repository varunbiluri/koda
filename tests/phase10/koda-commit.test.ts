import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/tools/terminal-tools.js', () => ({
  runTerminal: vi.fn(),
}));

import { runTerminal } from '../../src/tools/terminal-tools.js';
import { createKodaCommit, KODA_AUTHOR } from '../../src/tools/git-tools.js';

const mockRun = runTerminal as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: all commands succeed
  mockRun.mockResolvedValue({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } });
});

describe('createKodaCommit', () => {
  it('stages files and commits with Koda AI author', async () => {
    mockRun
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } }) // git add
      .mockResolvedValueOnce({ success: true, data: { stdout: '[main abc1234] feat: auth\n', stderr: '', exitCode: 0 } }) // git commit
      .mockResolvedValueOnce({ success: true, data: { stdout: 'abc1234\n', stderr: '', exitCode: 0 } }); // git rev-parse

    const result = await createKodaCommit('feat: add auth', '/repo');

    expect(result.success).toBe(true);
    expect(result.data?.hash).toBe('abc1234');
  });

  it('commit message includes "Generated with help from Koda AI."', async () => {
    mockRun
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } })
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } })
      .mockResolvedValueOnce({ success: true, data: { stdout: 'abc\n', stderr: '', exitCode: 0 } });

    const result = await createKodaCommit('fix: validate input', '/repo');

    // The full commit message stored in result.data.message must contain attribution
    expect(result.data?.message).toContain('Generated with help from Koda AI.');
    expect(result.data?.message).toContain('Co-authored-by: Koda AI');
  });

  it('commit command uses Co-authored-by trailer (not --author flag)', async () => {
    mockRun
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } })
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } })
      .mockResolvedValueOnce({ success: true, data: { stdout: 'def\n', stderr: '', exitCode: 0 } });

    await createKodaCommit('chore: cleanup', '/repo');

    const commitCall = mockRun.mock.calls[1][0] as string;
    expect(commitCall).not.toContain('--author=');
    expect(commitCall).toContain('Co-authored-by: Koda AI');
    expect(commitCall).toContain('268287658+koda-ai-engineer@users.noreply.github.com');
  });

  it('returns failure when git add fails', async () => {
    mockRun.mockResolvedValueOnce({ success: false, error: 'not a git repo' });

    const result = await createKodaCommit('feat: test', '/repo');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/git add failed/);
  });

  it('returns failure when git commit fails', async () => {
    mockRun
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } }) // add ok
      .mockResolvedValueOnce({ success: false, error: 'nothing to commit' }); // commit fails

    const result = await createKodaCommit('feat: test', '/repo');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/git commit failed/);
  });

  it('exports KODA_AUTHOR constant with updated noreply email', () => {
    expect(KODA_AUTHOR).toContain('Koda AI');
    expect(KODA_AUTHOR).toContain('268287658+koda-ai-engineer@users.noreply.github.com');
  });

  it('stages only specified files when provided', async () => {
    mockRun
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } })
      .mockResolvedValueOnce({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } })
      .mockResolvedValueOnce({ success: true, data: { stdout: 'ghi\n', stderr: '', exitCode: 0 } });

    await createKodaCommit('fix: auth', '/repo', ['src/auth.ts', 'src/middleware.ts']);

    const addCall = mockRun.mock.calls[0][0] as string;
    expect(addCall).toContain('src/auth.ts');
    expect(addCall).toContain('src/middleware.ts');
  });
});
