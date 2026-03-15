import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChatMessage } from '../../src/ai/types.js';
import { saveSession, loadSession, appendMessage } from '../../src/memory/conversation-store.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-persist-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const messages: ChatMessage[] = [
  { role: 'user', content: 'build auth system' },
  { role: 'assistant', content: 'I will create login endpoint first...' },
  { role: 'user', content: 'also add JWT tokens' },
];

describe('conversation persistence', () => {
  it('saves and reloads a session across restarts', async () => {
    const id = await saveSession(messages, tmpDir, 'session-2026-03-15');

    const loaded = await loadSession(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('session-2026-03-15');
    expect(loaded!.messages).toHaveLength(3);
    expect(loaded!.messages[2].content).toBe('also add JWT tokens');
  });

  it('session file is written to .koda/sessions/', async () => {
    await saveSession(messages, tmpDir, 'test-sess');
    const stat = await fs.stat(path.join(tmpDir, '.koda', 'sessions', 'test-sess.json'));
    expect(stat.isFile()).toBe(true);
  });

  it('loadSession returns null for empty directory', async () => {
    const result = await loadSession(tmpDir);
    expect(result).toBeNull();
  });

  it('appendMessage grows the session incrementally', async () => {
    await saveSession(messages, tmpDir, 'incremental');

    await appendMessage({ role: 'user', content: 'add refresh tokens' }, tmpDir, 'incremental');
    await appendMessage({ role: 'assistant', content: 'Done!' }, tmpDir, 'incremental');

    const loaded = await loadSession(tmpDir);
    expect(loaded!.messages).toHaveLength(5);
    expect(loaded!.messages[4].content).toBe('Done!');
  });

  it('createdAt is a valid ISO string', async () => {
    await saveSession(messages, tmpDir, 'ts-test');
    const loaded = await loadSession(tmpDir);
    expect(() => new Date(loaded!.createdAt)).not.toThrow();
    expect(loaded!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('latest session is returned when multiple exist', async () => {
    await saveSession([{ role: 'user', content: 'old' }], tmpDir, 'session-1000');
    await saveSession([{ role: 'user', content: 'newer' }], tmpDir, 'session-9999');
    await saveSession([{ role: 'user', content: 'newest' }], tmpDir, 'session-9999z');

    const result = await loadSession(tmpDir);
    expect(result!.messages[0].content).toBe('newest');
  });
});
