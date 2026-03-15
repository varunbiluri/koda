import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChatMessage } from '../../src/ai/types.js';
import {
  saveSession,
  loadSession,
  appendMessage,
} from '../../src/memory/conversation-store.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'koda-conv-store-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const sampleHistory: ChatMessage[] = [
  { role: 'user', content: 'Hello Koda' },
  { role: 'assistant', content: 'Hi! How can I help?' },
];

describe('saveSession', () => {
  it('creates a session file inside .koda/sessions/', async () => {
    const id = await saveSession(sampleHistory, tmpDir);

    const expectedFile = path.join(tmpDir, '.koda', 'sessions', `${id}.json`);
    const raw = await fs.readFile(expectedFile, 'utf-8');
    const session = JSON.parse(raw);

    expect(session.sessionId).toBe(id);
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.createdAt).toBeTruthy();
  });

  it('uses provided sessionId when given', async () => {
    const id = await saveSession(sampleHistory, tmpDir, 'my-session');
    expect(id).toBe('my-session');

    const file = path.join(tmpDir, '.koda', 'sessions', 'my-session.json');
    await expect(fs.access(file)).resolves.toBeUndefined();
  });
});

describe('loadSession', () => {
  it('returns null when no sessions exist', async () => {
    const result = await loadSession(tmpDir);
    expect(result).toBeNull();
  });

  it('loads the most recent session', async () => {
    // Create two sessions with different IDs (sorted descending by name)
    await saveSession([{ role: 'user', content: 'older' }], tmpDir, 'session-1000');
    await saveSession([{ role: 'user', content: 'newer' }], tmpDir, 'session-2000');

    const result = await loadSession(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.messages[0].content).toBe('newer');
  });

  it('restores messages correctly', async () => {
    await saveSession(sampleHistory, tmpDir, 'test-session');

    const result = await loadSession(tmpDir);
    expect(result!.sessionId).toBe('test-session');
    expect(result!.messages).toHaveLength(2);
    expect(result!.messages[1].role).toBe('assistant');
  });
});

describe('appendMessage', () => {
  it('adds a message to an existing session', async () => {
    await saveSession(sampleHistory, tmpDir, 'append-test');

    const newMsg: ChatMessage = { role: 'user', content: 'Follow-up question' };
    await appendMessage(newMsg, tmpDir, 'append-test');

    const result = await loadSession(tmpDir);
    expect(result!.messages).toHaveLength(3);
    expect(result!.messages[2].content).toBe('Follow-up question');
  });

  it('creates a new session file if it does not exist', async () => {
    const msg: ChatMessage = { role: 'user', content: 'First message' };
    await appendMessage(msg, tmpDir, 'brand-new');

    const file = path.join(tmpDir, '.koda', 'sessions', 'brand-new.json');
    await expect(fs.access(file)).resolves.toBeUndefined();
  });
});
