import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  findSlashCommand,
  getCommandsByCategory,
  canonicalSlashCommand,
  SLASH_COMMANDS,
} from '../../src/cli/session/slash/registry.js';
import {
  loadMcpConfig,
  saveGlobalMcpConfig,
  addGlobalMcpServer,
  removeGlobalMcpServer,
  getGlobalMcpPath,
} from '../../src/mcp/config-store.js';

describe('slash registry', () => {
  it('includes Claude Code–aligned core commands', () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain('/help');
    expect(names).toContain('/mcp');
    expect(names).toContain('/compact');
    expect(names).toContain('/doctor');
    expect(names).toContain('/commit');
  });

  it('resolves aliases to canonical names', () => {
    expect(canonicalSlashCommand('/quit')).toBe('/exit');
    expect(canonicalSlashCommand('/reset')).toBe('/compact');
    expect(canonicalSlashCommand('/budget')).toBe('/cost');
  });

  it('finds commands case-insensitively', () => {
    expect(findSlashCommand('/HELP')?.name).toBe('/help');
  });

  it('groups commands by category for /help', () => {
    const grouped = getCommandsByCategory();
    expect(grouped.get('mcp')?.some((c) => c.name === '/mcp')).toBe(true);
    expect(grouped.get('help')?.length).toBeGreaterThan(0);
  });

  it('marks incomplete commands as wip', () => {
    const wip = SLASH_COMMANDS.filter((c) => c.wip);
    expect(wip.some((c) => c.name === '/vim')).toBe(true);
    expect(wip.some((c) => c.name === '/commit')).toBe(false);
    expect(wip.some((c) => c.name === '/help')).toBe(false);
  });
});

describe('mcp config store', () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-mcp-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads empty config when no files exist', async () => {
    const config = await loadMcpConfig(tmpDir);
    expect(config.servers).toEqual({});
  });

  it('persists global MCP servers', async () => {
    await addGlobalMcpServer('test', { command: 'echo', args: ['hi'], enabled: true });
    const config = await loadMcpConfig(process.cwd());
    expect(config.servers.test?.command).toBe('echo');
    expect(await fs.readFile(getGlobalMcpPath(), 'utf-8')).toContain('"test"');
  });

  it('removes global MCP servers', async () => {
    await addGlobalMcpServer('rm-me', { command: 'node', enabled: true });
    const removed = await removeGlobalMcpServer('rm-me');
    expect(removed).toBe(true);
    const config = await loadMcpConfig(process.cwd());
    expect(config.servers['rm-me']).toBeUndefined();
  });

  it('merges project config over global', async () => {
    await saveGlobalMcpConfig({
      servers: { shared: { command: 'global', enabled: true } },
    });
    const projectPath = path.join(tmpDir, 'repo');
    await fs.mkdir(path.join(projectPath, '.koda'), { recursive: true });
    await fs.writeFile(
      path.join(projectPath, '.koda', 'mcp.json'),
      JSON.stringify({ servers: { shared: { command: 'project', enabled: true } } }),
      'utf-8',
    );

    const config = await loadMcpConfig(projectPath);
    expect(config.servers.shared?.command).toBe('project');
  });
});
