/**
 * Tests that ToolRegistry refuses to run destructive terminal commands.
 *
 * Safe commands must still pass through unaffected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/tools/terminal-tools.js', () => ({
  runTerminal: vi.fn().mockResolvedValue({
    success: true,
    data: { stdout: 'ok', stderr: '', exitCode: 0 },
  }),
}));
vi.mock('../../src/tools/filesystem-tools.js', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  searchCode: vi.fn(),
  listFiles: vi.fn(),
}));
vi.mock('../../src/tools/git-tools.js', () => ({
  gitBranch: vi.fn(),
  gitStatus: vi.fn(),
  gitDiff: vi.fn(),
  gitLog: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitCreatePr: vi.fn(),
  createKodaCommit: vi.fn(),
}));
vi.mock('../../src/tools/patch-tools.js', () => ({ applyPatch: vi.fn() }));
vi.mock('../../src/tools/web-tools.js', () => ({ fetchUrl: vi.fn() }));

import { ToolRegistry } from '../../src/tools/tool-registry.js';
import { runTerminal } from '../../src/tools/terminal-tools.js';

const mockRun = runTerminal as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

// ── Destructive commands must be blocked ──────────────────────────────────────

describe('run_terminal destructive command guard', () => {
  const BLOCKED = [
    'rm -rf /tmp/foo',
    'rm -rf .',
    'rm -fr src/',
    'rm -r build/',
    'git reset --hard HEAD~1',
    'git clean -fd',
    'git clean -f',
    'git push origin main --force',
    'DROP TABLE users',
    'TRUNCATE TABLE orders',
    'dd if=/dev/zero of=/dev/sda',
    'mkfs.ext4 /dev/sda1',
  ];

  for (const cmd of BLOCKED) {
    it(`blocks: ${cmd}`, async () => {
      const registry = new ToolRegistry('/repo');
      const result = await registry.execute('run_terminal', { command: cmd });
      expect(result).toContain('Error:');
      expect(result).toContain('Refusing');
      // The real runTerminal must NOT have been called
      expect(mockRun).not.toHaveBeenCalled();
    });
  }
});

// ── Safe commands must pass through ──────────────────────────────────────────

describe('run_terminal allows safe commands', () => {
  const SAFE = [
    'pnpm test',
    'pnpm build',
    'ls -la',
    'cat src/index.ts',
    'echo hello',
    'git status',
    'git log --oneline -5',
    'npm install',
    'python main.py',
  ];

  for (const cmd of SAFE) {
    it(`allows: ${cmd}`, async () => {
      const registry = new ToolRegistry('/repo');
      const result = await registry.execute('run_terminal', { command: cmd });
      expect(result).not.toContain('Refusing');
      expect(mockRun).toHaveBeenCalledWith(cmd, '/repo');
    });
  }
});
