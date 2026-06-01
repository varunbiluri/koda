import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ThreadMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  at: number;
}

export interface ThreadRecord {
  id: string;
  title: string;
  mode: 'local';
  createdAt: number;
  updatedAt: number;
  messages: ThreadMessage[];
}

interface ThreadFile {
  version: number;
  threads: ThreadRecord[];
}

const FILE_VERSION = 1;

export class ThreadStore {
  private threads: ThreadRecord[] = [];
  private readonly filePath: string;
  private loaded = false;

  constructor(rootPath: string) {
    this.filePath = path.join(rootPath, '.koda', 'desktop', 'threads.json');
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as ThreadFile;
      this.threads = Array.isArray(data.threads) ? data.threads : [];
    } catch {
      this.threads = [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: ThreadFile = { version: FILE_VERSION, threads: this.threads };
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  list(): ThreadRecord[] {
    return [...this.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): ThreadRecord | undefined {
    return this.threads.find((t) => t.id === id);
  }

  async create(title = 'New thread'): Promise<ThreadRecord> {
    await this.load();
    const now = Date.now();
    const thread: ThreadRecord = {
      id: crypto.randomBytes(8).toString('hex'),
      title,
      mode: 'local',
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.threads.unshift(thread);
    await this.persist();
    return thread;
  }

  async appendMessage(
    id: string,
    message: Omit<ThreadMessage, 'at'> & { at?: number },
  ): Promise<ThreadRecord | undefined> {
    await this.load();
    const thread = this.threads.find((t) => t.id === id);
    if (!thread) return undefined;
    thread.messages.push({ ...message, at: message.at ?? Date.now() });
    thread.updatedAt = Date.now();
    if (message.role === 'user' && thread.title === 'New thread') {
      thread.title = message.content.slice(0, 48) || thread.title;
    }
    await this.persist();
    return thread;
  }

  async updateTitle(id: string, title: string): Promise<ThreadRecord | undefined> {
    await this.load();
    const thread = this.threads.find((t) => t.id === id);
    if (!thread) return undefined;
    thread.title = title;
    thread.updatedAt = Date.now();
    await this.persist();
    return thread;
  }
}
