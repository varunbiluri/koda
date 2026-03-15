import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyPatch } from '../../src/tools/patch-tools.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-patch-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeTestFile(name: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await fs.writeFile(filePath, content, 'utf-8');
  return name;
}

describe('applyPatch', () => {
  it('replaces a single line', async () => {
    await writeTestFile('test.ts', 'line1\nline2\nline3\n');

    const result = await applyPatch('test.ts', 2, 2, 'replaced', tmpDir);

    expect(result.success).toBe(true);
    expect(result.data?.linesReplaced).toBe(1);
    expect(result.data?.linesInserted).toBe(1);

    const content = await fs.readFile(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('line1\nreplaced\nline3\n');
  });

  it('replaces multiple lines', async () => {
    await writeTestFile('multi.ts', 'a\nb\nc\nd\ne\n');

    const result = await applyPatch('multi.ts', 2, 4, 'new1\nnew2', tmpDir);

    expect(result.success).toBe(true);
    expect(result.data?.linesReplaced).toBe(3);
    expect(result.data?.linesInserted).toBe(2);

    const content = await fs.readFile(path.join(tmpDir, 'multi.ts'), 'utf-8');
    expect(content).toBe('a\nnew1\nnew2\ne\n');
  });

  it('replaces first line', async () => {
    await writeTestFile('first.ts', 'old\nkeep\n');

    const result = await applyPatch('first.ts', 1, 1, 'new', tmpDir);

    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, 'first.ts'), 'utf-8');
    expect(content).toBe('new\nkeep\n');
  });

  it('replaces last line', async () => {
    await writeTestFile('last.ts', 'keep\nold');

    const result = await applyPatch('last.ts', 2, 2, 'new', tmpDir);

    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, 'last.ts'), 'utf-8');
    expect(content).toBe('keep\nnew');
  });

  it('returns error when startLine is out of range', async () => {
    await writeTestFile('small.ts', 'only one line');

    const result = await applyPatch('small.ts', 5, 5, 'x', tmpDir);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/out of range/);
  });

  it('returns error when endLine < startLine', async () => {
    await writeTestFile('inv.ts', 'a\nb\nc\n');

    const result = await applyPatch('inv.ts', 3, 2, 'x', tmpDir);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/out of range/);
  });

  it('returns error for missing file', async () => {
    const result = await applyPatch('nonexistent.ts', 1, 1, 'x', tmpDir);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to apply patch/);
  });
});
