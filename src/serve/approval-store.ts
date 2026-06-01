import * as crypto from 'node:crypto';
import { diffStats } from './stage-parser.js';

export type ApprovalType = 'write' | 'command' | 'commit';

export interface PendingApproval {
  id: string;
  type: ApprovalType;
  target: string;
  detail?: string;
  filePath?: string;
  oldContent?: string;
  newContent?: string;
  added?: number;
  removed?: number;
  createdAt: number;
}

interface Waiter {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ApprovalStore {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly waiters = new Map<string, Waiter>();

  createWriteApproval(
    filePath: string,
    oldContent: string,
    newContent: string,
  ): PendingApproval {
    const { added, removed } = diffStats(oldContent, newContent);
    const approval: PendingApproval = {
      id: crypto.randomBytes(12).toString('hex'),
      type: 'write',
      target: filePath,
      filePath,
      oldContent,
      newContent,
      added,
      removed,
      createdAt: Date.now(),
    };
    this.pending.set(approval.id, approval);
    return approval;
  }

  listPending(): PendingApproval[] {
    return [...this.pending.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): PendingApproval | undefined {
    return this.pending.get(id);
  }

  wait(id: string, timeoutMs = 300_000): Promise<boolean> {
    if (!this.pending.has(id)) return Promise.resolve(false);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        this.pending.delete(id);
        resolve(false);
      }, timeoutMs);

      this.waiters.set(id, { resolve, timer });
    });
  }

  resolve(id: string, approved: boolean): boolean {
    const approval = this.pending.get(id);
    if (!approval) return false;

    this.pending.delete(id);
    const waiter = this.waiters.get(id);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(approved);
      this.waiters.delete(id);
    }
    return true;
  }
}
