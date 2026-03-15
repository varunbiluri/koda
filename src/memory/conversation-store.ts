import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatMessage } from '../ai/types.js';

export interface ConversationSession {
  sessionId: string;
  messages: ChatMessage[];
  createdAt: string;
}

const SESSIONS_DIR = '.koda/sessions';

function sessionsDir(rootPath: string): string {
  return path.join(rootPath, SESSIONS_DIR);
}

/** Save the current session history to disk. */
export async function saveSession(
  history: ChatMessage[],
  rootPath: string,
  sessionId?: string,
): Promise<string> {
  const id = sessionId ?? `session-${Date.now()}`;
  const dir = sessionsDir(rootPath);
  await fs.mkdir(dir, { recursive: true });

  const session: ConversationSession = {
    sessionId: id,
    messages: history,
    createdAt: new Date().toISOString(),
  };

  const filePath = path.join(dir, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  return id;
}

/** Load the most recent session from disk. Returns null if none exists. */
export async function loadSession(rootPath: string): Promise<ConversationSession | null> {
  const dir = sessionsDir(rootPath);
  try {
    const files = await fs.readdir(dir);
    const sessionFiles = files
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse(); // most recent first

    if (sessionFiles.length === 0) return null;

    const latest = path.join(dir, sessionFiles[0]);
    const content = await fs.readFile(latest, 'utf-8');
    return JSON.parse(content) as ConversationSession;
  } catch {
    return null;
  }
}

/** Append a single message to an existing session file, or create a new one. */
export async function appendMessage(
  message: ChatMessage,
  rootPath: string,
  sessionId: string,
): Promise<void> {
  const dir = sessionsDir(rootPath);
  const filePath = path.join(dir, `${sessionId}.json`);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const session = JSON.parse(content) as ConversationSession;
    session.messages.push(message);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  } catch {
    // File doesn't exist yet — create it
    await saveSession([message], rootPath, sessionId);
  }
}
