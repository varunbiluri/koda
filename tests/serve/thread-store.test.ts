import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadStore } from '../../src/serve/thread-store.js';

describe('ThreadStore', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-thread-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('creates and persists threads', async () => {
    const store = new ThreadStore(tmp);
    const thread = await store.create('Fix auth');
    expect(thread.title).toBe('Fix auth');

    await store.appendMessage(thread.id, { role: 'user', content: 'hello' });
    const loaded = new ThreadStore(tmp);
    await loaded.load();
    const found = loaded.get(thread.id);
    expect(found?.messages).toHaveLength(1);
  });
});
