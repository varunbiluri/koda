import type { ChatMetrics } from '../ai/reasoning/reasoning-engine.js';
import type { ToolKind } from './stage-parser.js';
import type { PendingApproval } from './approval-store.js';
import type { ThreadRecord } from './thread-store.js';

export type ServeEvent =
  | { type: 'thinking' }
  | { type: 'token'; text: string }
  | { type: 'tool'; kind: ToolKind; detail: string; durationMs?: number }
  | { type: 'terminal'; line: string }
  | { type: 'plan'; steps: string[]; activeStep?: number }
  | {
      type: 'context';
      files: string[];
      tokens: number;
      fileCount?: number;
      chunkCount?: number;
      symbolCount?: number;
      refs?: number;
    }
  | {
      type: 'diff';
      filePath: string;
      oldContent: string;
      newContent: string;
      added: number;
      removed: number;
    }
  | { type: 'approval'; approval: PendingApproval }
  | { type: 'approval_resolved'; id: string; approved: boolean }
  | { type: 'timeline'; entries: Array<{ name: string; durationMs: number }> }
  | { type: 'info'; message: string }
  | { type: 'error'; message: string; suggestion?: string }
  | {
      type: 'done';
      output?: string;
      handled?: boolean;
      metrics?: ChatMetrics;
      kei?: number;
      threadId?: string;
    };

export interface ServeStatus {
  repoName: string;
  branch: string;
  indexStatus: 'ready' | 'missing' | 'stale';
  model: string;
  provider: string;
  hasConfig: boolean;
  rootPath: string;
  fileCount?: number;
  chunkCount?: number;
  symbolCount?: number;
}

export interface ServeServerOptions {
  rootPath: string;
  host?: string;
  port?: number;
  token?: string;
  /** When true, skip approval prompts (CLI-style). Desktop defaults to false. */
  autoApprove?: boolean;
}

export type { ThreadRecord, PendingApproval };
