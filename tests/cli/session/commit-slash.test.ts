import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../../src/ai/config-store.js', () => ({
  configExists: vi.fn().mockResolvedValue(true),
  loadConfig: vi.fn().mockResolvedValue({
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    apiKey:   'test',
    model:    'gpt-4o',
  }),
}));

const mockSend = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'fix(auth): invalidate reset token after use' } }],
});

vi.mock('../../../src/ai/providers/provider-factory.js', () => ({
  createProvider: vi.fn(() => ({ sendChatCompletion: mockSend })),
}));

vi.mock('../../../src/tools/git-tools.js', () => ({
  gitCommit: vi.fn().mockResolvedValue({
    success: true,
    data:    '[main abc1234] fix(auth): invalidate reset token',
  }),
}));

vi.mock('../../../src/runtime/permission-gate.js', () => ({
  permissionGate: {
    requestApproval: vi.fn().mockResolvedValue(true),
  },
}));

import { execSync } from 'node:child_process';
import { gitCommit } from '../../../src/tools/git-tools.js';
import { permissionGate } from '../../../src/runtime/permission-gate.js';
import {
  sanitizeCommitMessage,
  truncateDiff,
  generateCommitMessage,
  runSlashCommit,
} from '../../../src/cli/session/slash/commit-handler.js';

describe('sanitizeCommitMessage', () => {
  it('strips markdown fences', () => {
    expect(sanitizeCommitMessage('```\nfix: bug\n```')).toBe('fix: bug');
  });

  it('strips surrounding quotes', () => {
    expect(sanitizeCommitMessage('"fix: bug"')).toBe('fix: bug');
  });
});

describe('truncateDiff', () => {
  it('truncates long diffs', () => {
    const long = 'a'.repeat(20_000);
    const out = truncateDiff(long, 100);
    expect(out).toContain('truncated');
    expect(out.length).toBeLessThan(long.length);
  });
});

describe('generateCommitMessage', () => {
  beforeEach(() => mockSend.mockClear());

  it('returns sanitized model output', async () => {
    const msg = await generateCommitMessage('diff --git a/foo b/foo');
    expect(msg).toBe('fix(auth): invalidate reset token after use');
    expect(mockSend).toHaveBeenCalledOnce();
  });
});

describe('runSlashCommit', () => {
  const ui = {
    renderInfo:     vi.fn(),
    renderError:    vi.fn(),
    renderThinking: vi.fn().mockReturnValue({ text: '' }),
    stopSpinner:    vi.fn(),
    renderSuccess:  vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(execSync).mockReset();
    vi.mocked(gitCommit).mockClear();
    vi.mocked(permissionGate.requestApproval).mockClear();
    ui.renderInfo.mockClear();
    ui.renderError.mockClear();
    ui.renderSuccess.mockClear();
  });

  it('reports when nothing is staged', async () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const s = String(cmd);
      if (s.includes('diff --staged') && !s.includes('name-status')) return '';
      if (s.includes('status --short')) return ' M src/foo.ts';
      return '';
    });

    await runSlashCommit({ rootPath: '/repo', ui: ui as never });

    expect(ui.renderInfo).toHaveBeenCalledWith(expect.stringContaining('Nothing staged'));
    expect(gitCommit).not.toHaveBeenCalled();
  });

  it('generates message, asks approval, and commits staged changes', async () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const s = String(cmd);
      if (s.includes('diff --staged') && !s.includes('name-status')) {
        return 'diff --git a/src/auth.ts b/src/auth.ts\n+fix';
      }
      if (s.includes('name-status')) return 'M\tsrc/auth.ts';
      return '';
    });

    await runSlashCommit({ rootPath: '/repo', ui: ui as never });

    expect(permissionGate.requestApproval).toHaveBeenCalledWith(
      'git_commit',
      expect.stringContaining('fix(auth)'),
    );
    expect(gitCommit).toHaveBeenCalledWith(
      'fix(auth): invalidate reset token after use',
      '/repo',
    );
    expect(ui.renderSuccess).toHaveBeenCalled();
  });

  it('uses user-provided message without calling the model', async () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const s = String(cmd);
      if (s.includes('diff --staged') && !s.includes('name-status')) return '+change';
      if (s.includes('name-status')) return 'M\tfile.ts';
      return '';
    });

    mockSend.mockClear();
    await runSlashCommit({
      rootPath:    '/repo',
      ui:          ui as never,
      userMessage: 'chore: manual message',
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(gitCommit).toHaveBeenCalledWith('chore: manual message', '/repo');
  });

  it('cancels when user denies approval', async () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const s = String(cmd);
      if (s.includes('diff --staged') && !s.includes('name-status')) return '+x';
      if (s.includes('name-status')) return 'M\tx.ts';
      return '';
    });
    vi.mocked(permissionGate.requestApproval).mockResolvedValueOnce(false);

    await runSlashCommit({ rootPath: '/repo', ui: ui as never });

    expect(gitCommit).not.toHaveBeenCalled();
    expect(ui.renderInfo).toHaveBeenCalledWith('Commit cancelled.');
  });
});
