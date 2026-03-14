import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionManager } from '../../src/security/permission-manager.js';

// Mock prompts so tests never wait for interactive input
vi.mock('prompts', () => {
  const fn = vi.fn();
  (fn as unknown as { override: ReturnType<typeof vi.fn> }).override = vi.fn();
  return { default: fn };
});

// Mock fs to control the permissions file
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// ── Risk classification ───────────────────────────────────────────────────────

describe('PermissionManager.classifyRisk', () => {
  it('classifies ls as safe', () => {
    expect(PermissionManager.classifyRisk('ls -la')).toBe('safe');
  });

  it('classifies cat as safe', () => {
    expect(PermissionManager.classifyRisk('cat src/index.ts')).toBe('safe');
  });

  it('classifies git status as safe', () => {
    expect(PermissionManager.classifyRisk('git status')).toBe('safe');
  });

  it('classifies git diff as safe', () => {
    expect(PermissionManager.classifyRisk('git diff HEAD')).toBe('safe');
  });

  it('classifies git log as safe', () => {
    expect(PermissionManager.classifyRisk('git log -5 --oneline')).toBe('safe');
  });

  it('classifies npm test as medium', () => {
    expect(PermissionManager.classifyRisk('npm test')).toBe('medium');
  });

  it('classifies pnpm build as medium', () => {
    expect(PermissionManager.classifyRisk('pnpm build')).toBe('medium');
  });

  it('classifies git commit as medium', () => {
    expect(PermissionManager.classifyRisk('git commit -m "fix"')).toBe('medium');
  });

  it('classifies rm as high', () => {
    expect(PermissionManager.classifyRisk('rm -rf dist/')).toBe('high');
  });

  it('classifies git push as high', () => {
    expect(PermissionManager.classifyRisk('git push origin main')).toBe('high');
  });

  it('classifies git reset as high', () => {
    expect(PermissionManager.classifyRisk('git reset --hard HEAD~1')).toBe('high');
  });

  it('classifies docker as high', () => {
    expect(PermissionManager.classifyRisk('docker build .')).toBe('high');
  });

  it('classifies chmod as high', () => {
    expect(PermissionManager.classifyRisk('chmod +x script.sh')).toBe('high');
  });

  it('classifies sudo as high', () => {
    expect(PermissionManager.classifyRisk('sudo npm install -g')).toBe('high');
  });

  it('classifies mv as high', () => {
    expect(PermissionManager.classifyRisk('mv src/old.ts src/new.ts')).toBe('high');
  });
});

// ── check() — safe commands pass without prompting ───────────────────────────

describe('PermissionManager.check — safe commands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows safe commands without prompting', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const result = await PermissionManager.check('git status');
    expect(result).toBe(true);
    expect(prompts).not.toHaveBeenCalled();
  });
});

// ── check() — KODA_SKIP_PERMISSIONS bypass ───────────────────────────────────

describe('PermissionManager.check — bypass via env var', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KODA_SKIP_PERMISSIONS = 'true';
  });

  afterEach(() => {
    delete process.env.KODA_SKIP_PERMISSIONS;
  });

  it('skips prompt when KODA_SKIP_PERMISSIONS=true', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    const result = await PermissionManager.check('rm -rf dist/');
    expect(result).toBe(true);
    expect(prompts).not.toHaveBeenCalled();
  });
});

// ── check() — approval prompt ─────────────────────────────────────────────────

describe('PermissionManager.check — prompt flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KODA_SKIP_PERMISSIONS;
  });

  it('returns true when user selects Yes', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts.mockResolvedValueOnce({ choice: 'yes' });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await PermissionManager.check('npm test');
    expect(result).toBe(true);
  });

  it('returns false when user selects No', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts.mockResolvedValueOnce({ choice: 'no' });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await PermissionManager.check('npm test');
    expect(result).toBe(false);
  });

  it('returns false when prompt is cancelled (undefined choice)', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts.mockResolvedValueOnce({ choice: undefined });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await PermissionManager.check('npm test');
    expect(result).toBe(false);
  });
});

// ── check() — remember ────────────────────────────────────────────────────────

describe('PermissionManager.check — remember approval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KODA_SKIP_PERMISSIONS;
  });

  it('persists command when user selects Yes remember', async () => {
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts.mockResolvedValueOnce({ choice: 'remember' });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await PermissionManager.check('pnpm build');
    expect(result).toBe(true);
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('permissions.json'),
      expect.stringContaining('pnpm build'),
      'utf-8',
    );
  });

  it('skips prompt when command was previously remembered', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ approvedCommands: ['pnpm build'] }) as unknown as Buffer,
    );

    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;

    const result = await PermissionManager.check('pnpm build');
    expect(result).toBe(true);
    expect(prompts).not.toHaveBeenCalled();
  });
});

// ── loadApproved / persistApproval ───────────────────────────────────────────

describe('PermissionManager persistence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loadApproved returns empty array when file does not exist', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    const result = await PermissionManager.loadApproved();
    expect(result).toEqual([]);
  });

  it('loadApproved returns existing commands from file', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ approvedCommands: ['npm test', 'git commit'] }) as unknown as Buffer,
    );
    const result = await PermissionManager.loadApproved();
    expect(result).toEqual(['npm test', 'git commit']);
  });

  it('persistApproval adds new command without duplicates', async () => {
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ approvedCommands: ['npm test'] }) as unknown as Buffer,
    );
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    await PermissionManager.persistApproval('pnpm build');

    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
    expect(written.approvedCommands).toContain('npm test');
    expect(written.approvedCommands).toContain('pnpm build');
    expect(written.approvedCommands).toHaveLength(2);
  });

  it('persistApproval does not write when command already exists', async () => {
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ approvedCommands: ['npm test'] }) as unknown as Buffer,
    );
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    await PermissionManager.persistApproval('npm test');

    // No write needed — command was already present
    expect(writeFile).not.toHaveBeenCalled();
  });
});
