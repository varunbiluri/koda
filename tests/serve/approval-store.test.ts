import { describe, it, expect } from 'vitest';
import { ApprovalStore } from '../../src/serve/approval-store.js';

describe('ApprovalStore', () => {
  it('waits and resolves write approval', async () => {
    const store = new ApprovalStore();
    const approval = store.createWriteApproval('src/a.ts', 'old', 'new\nline');
    expect(approval.added).toBeGreaterThan(0);

    const waitP = store.wait(approval.id, 5000);
    expect(store.resolve(approval.id, true)).toBe(true);
    await expect(waitP).resolves.toBe(true);
  });

  it('returns false when rejected', async () => {
    const store = new ApprovalStore();
    const approval = store.createWriteApproval('b.ts', '', 'x');
    const waitP = store.wait(approval.id, 5000);
    store.resolve(approval.id, false);
    await expect(waitP).resolves.toBe(false);
  });
});
