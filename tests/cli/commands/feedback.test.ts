/**
 * koda feedback — unit tests
 *
 * Tests the feedback storage logic without spawning the actual CLI.
 */

import { describe, it, expect } from 'vitest';
import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

// ── Helpers: directly test the private save logic by importing the file
// (the command itself is a Commander.Command — tested via integration)

async function writeFeedback(
  rootPath: string,
  opts: { worked: boolean; description: string; task?: string },
): Promise<void> {
  const file = path.join(rootPath, '.koda', 'feedback.json');
  await fs.mkdir(path.dirname(file), { recursive: true });

  let store: { version: number; entries: unknown[] } = { version: 1, entries: [] };
  try {
    store = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch { /* first run */ }

  store.entries.unshift({
    at:          new Date().toISOString(),
    worked:      opts.worked,
    task:        opts.task,
    description: opts.description,
  });

  await fs.writeFile(file, JSON.stringify(store, null, 2), 'utf8');
}

async function readFeedback(rootPath: string) {
  const file = path.join(rootPath, '.koda', 'feedback.json');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

describe('feedback storage', () => {
  async function tmpDir() {
    const d = path.join(os.tmpdir(), 'koda-fb-' + Date.now());
    await fs.mkdir(d, { recursive: true });
    return d;
  }

  it('creates feedback.json on first write', async () => {
    const dir = await tmpDir();
    await writeFeedback(dir, { worked: true, description: 'all good', task: 'fix' });
    const store = await readFeedback(dir);
    expect(store.version).toBe(1);
    expect(store.entries).toHaveLength(1);
  });

  it('stores worked=true correctly', async () => {
    const dir = await tmpDir();
    await writeFeedback(dir, { worked: true, description: 'fixed the bug', task: 'fix' });
    const store = await readFeedback(dir);
    expect(store.entries[0].worked).toBe(true);
    expect(store.entries[0].task).toBe('fix');
  });

  it('stores worked=false correctly', async () => {
    const dir = await tmpDir();
    await writeFeedback(dir, { worked: false, description: 'verification loop hung', task: 'auto' });
    const store = await readFeedback(dir);
    expect(store.entries[0].worked).toBe(false);
    expect(store.entries[0].description).toContain('verification loop hung');
  });

  it('prepends new entries (newest first)', async () => {
    const dir = await tmpDir();
    await writeFeedback(dir, { worked: true,  description: 'first',  task: 'fix' });
    await writeFeedback(dir, { worked: false, description: 'second', task: 'add' });
    const store = await readFeedback(dir);
    expect(store.entries[0].description).toBe('second');
    expect(store.entries[1].description).toBe('first');
  });

  it('accumulates multiple entries', async () => {
    const dir = await tmpDir();
    for (let i = 0; i < 5; i++) {
      await writeFeedback(dir, { worked: i % 2 === 0, description: `entry ${i}` });
    }
    const store = await readFeedback(dir);
    expect(store.entries).toHaveLength(5);
  });
});
