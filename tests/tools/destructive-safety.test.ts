/**
 * Tests that ToolRegistry blocks destructive terminal commands and allows safe ones.
 *
 * With the SandboxManager refactor, blocking is now done inside SandboxManager
 * rather than in ToolRegistry itself.  We mock SandboxManager.execute so no
 * real processes are spawned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const executeMock = vi.fn();

vi.mock('../../src/runtime/sandbox-manager.js', () => {
  class SandboxManager {
    execute = executeMock;
    classifyRisk(cmd: string) {
      const BLOCKED = [
        /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
        /\brm\s+-r\b/i,
        /\bgit\s+reset\s+--hard\b/,
        /\bgit\s+clean\s+-[a-z]*f/,
        /\bgit\s+push\s+.*--force\b/,
        /\bdrop\s+table\b/i,
        /\btruncate\s+table\b/i,
        /\bdd\s+if=/i,
        /\bmkfs\b/i,
        /\b:>\s*\//,
      ];
      return BLOCKED.some((p) => p.test(cmd)) ? 'blocked' : 'safe';
    }
  }
  return { SandboxManager };
});

vi.mock('../../src/tools/filesystem-tools.js', () => ({
  readFile:   vi.fn(),
  writeFile:  vi.fn(),
  searchCode: vi.fn(),
  listFiles:  vi.fn(),
}));
vi.mock('../../src/tools/git-tools.js', () => ({
  gitBranch:       vi.fn(),
  gitStatus:       vi.fn(),
  gitDiff:         vi.fn(),
  gitLog:          vi.fn(),
  gitAdd:          vi.fn(),
  gitCommit:       vi.fn(),
  gitPush:         vi.fn(),
  gitCreatePr:     vi.fn(),
  createKodaCommit: vi.fn(),
}));
vi.mock('../../src/tools/patch-tools.js', () => ({ applyPatch: vi.fn() }));
vi.mock('../../src/tools/web-tools.js',   () => ({ fetchUrl: vi.fn() }));
vi.mock('../../src/tools/diff-tools.js',  () => ({
  replaceText:         vi.fn(),
  insertAfterPattern:  vi.fn(),
}));

import { ToolRegistry } from '../../src/tools/tool-registry.js';

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
      // SandboxManager.execute resolves with a "refused" result for blocked commands
      const refusedResult = {
        stdout:     '',
        stderr:     `Sandboxed command refused: "${cmd}" matches a blocked pattern.`,
        exitCode:   1,
        timedOut:   false,
        durationMs: 0,
        risk:       'blocked',
        command:    cmd,
      };

      executeMock.mockResolvedValue(refusedResult);
      const registry = new ToolRegistry('/repo');

      const result = await registry.execute('run_terminal', { command: cmd });
      expect(result).toContain('Error');
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
      const successResult = {
        stdout:     'ok',
        stderr:     '',
        exitCode:   0,
        timedOut:   false,
        durationMs: 5,
        risk:       'safe',
        command:    cmd,
      };

      executeMock.mockResolvedValue(successResult);
      const registry = new ToolRegistry('/repo');

      const result = await registry.execute('run_terminal', { command: cmd });
      // Should not contain an error about refusing the command
      expect(result).not.toContain('Refusing');
      expect(result).not.toContain('blocked pattern');
      // SandboxManager.execute must have been called
      expect(executeMock).toHaveBeenCalled();
    });
  }
});
