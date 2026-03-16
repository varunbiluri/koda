/**
 * Tests for ContextBudgetManager.
 */
import { describe, it, expect } from 'vitest';
import { ContextBudgetManager } from '../../../src/ai/context/context-budget-manager.js';
import type { BudgetMessage } from '../../../src/ai/context/context-budget-manager.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function msg(role: string, chars: number): BudgetMessage {
  return { role, content: 'x'.repeat(chars) };
}

function systemMsg(chars: number): BudgetMessage {
  return msg('system', chars);
}

function userMsg(chars: number): BudgetMessage {
  return msg('user', chars);
}

function assistantMsg(chars: number): BudgetMessage {
  return msg('assistant', chars);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ContextBudgetManager.estimateTokens()', () => {
  it('estimates tokens as ceil(chars / 4)', () => {
    const cbm = new ContextBudgetManager();
    expect(cbm.estimateTokens('1234')).toBe(1);
    expect(cbm.estimateTokens('12345')).toBe(2);
    expect(cbm.estimateTokens('')).toBe(0);
    expect(cbm.estimateTokens('x'.repeat(400))).toBe(100);
  });

  it('handles large strings correctly', () => {
    const cbm = new ContextBudgetManager();
    expect(cbm.estimateTokens('x'.repeat(10_000))).toBe(2_500);
  });
});

describe('ContextBudgetManager.estimateMessagesTokens()', () => {
  it('sums token estimates across messages', () => {
    const cbm = new ContextBudgetManager();
    const msgs = [userMsg(400), assistantMsg(800)];
    expect(cbm.estimateMessagesTokens(msgs)).toBe(300); // 100 + 200
  });

  it('returns 0 for empty list', () => {
    const cbm = new ContextBudgetManager();
    expect(cbm.estimateMessagesTokens([])).toBe(0);
  });

  it('handles null content gracefully', () => {
    const cbm = new ContextBudgetManager();
    const msgs: BudgetMessage[] = [{ role: 'tool', content: null }];
    expect(cbm.estimateMessagesTokens(msgs)).toBe(0);
  });
});

describe('ContextBudgetManager.enforce() — within budget', () => {
  it('returns messages unchanged when under budget', () => {
    // 1000 available tokens → 4000 chars budget
    const cbm  = new ContextBudgetManager(1_000, 0);
    const msgs = [systemMsg(400), userMsg(400), assistantMsg(400)];
    const result = cbm.enforce(msgs);
    expect(result).toHaveLength(3);
  });

  it('returns empty array for empty input', () => {
    const cbm = new ContextBudgetManager();
    expect(cbm.enforce([])).toHaveLength(0);
  });
});

describe('ContextBudgetManager.enforce() — over budget, trimming', () => {
  it('preserves system message when trimming', () => {
    // maxTokens=500 (chars/4), reservedForResponse=0 → 2000 char budget
    const cbm = new ContextBudgetManager(500, 0);
    const msgs = [
      systemMsg(400),   // 100 tokens — always kept
      userMsg(400),     // 100 tokens — oldest non-system (evicted)
      assistantMsg(400), // 100 tokens
      userMsg(400),     // 100 tokens — newest (always kept)
    ];
    const result = cbm.enforce(msgs);
    expect(result[0].role).toBe('system');
  });

  it('always keeps the most recent non-system message', () => {
    const cbm = new ContextBudgetManager(200, 0); // 800 char budget
    const msgs = [
      systemMsg(100),   // 25 tokens
      userMsg(400),     // 100 tokens — evict
      userMsg(400),     // 100 tokens — evict
      assistantMsg(100), // 25 tokens — newest, keep
    ];
    const result = cbm.enforce(msgs);
    const last = result[result.length - 1];
    expect(last.role).toBe('assistant');
  });

  it('evicts oldest messages first', () => {
    // Budget = 300 tokens → 1200 chars
    const cbm = new ContextBudgetManager(300, 0);
    const msgs = [
      systemMsg(100),   // 25 tokens
      userMsg(1200),    // 300 tokens — first old message (evicted)
      assistantMsg(100), // 25 tokens — kept
      userMsg(100),     // 25 tokens — newest, kept
    ];
    const result = cbm.enforce(msgs);
    // The 1200-char middle message should be evicted
    const lengths = result.map((m) => (m.content as string).length);
    expect(lengths).not.toContain(1200);
  });

  it('falls back to system + last when floor exceeds budget', () => {
    // Tiny budget — even system + last message barely fits
    const cbm = new ContextBudgetManager(50, 0); // 200 char budget
    const msgs = [
      systemMsg(100),    // 25 tokens — system, always kept
      userMsg(400),      // 100 tokens
      userMsg(400),      // 100 tokens
      assistantMsg(400), // 100 tokens — last, always kept
    ];
    const result = cbm.enforce(msgs);
    expect(result.some((m) => m.role === 'system')).toBe(true);
    expect(result[result.length - 1].role).toBe('assistant');
    // Only system + last should remain
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('multiple system messages are all preserved', () => {
    const cbm = new ContextBudgetManager(300, 0); // 1200 char budget
    const msgs: BudgetMessage[] = [
      systemMsg(100),     // 25 tokens
      systemMsg(100),     // 25 tokens — second system msg
      userMsg(2000),      // 500 tokens — evicted
      userMsg(100),       // 25 tokens — last, kept
    ];
    const result = cbm.enforce(msgs);
    const systemCount = result.filter((m) => m.role === 'system').length;
    expect(systemCount).toBe(2);
  });
});

describe('ContextBudgetManager — custom limits', () => {
  it('respects custom maxTokens and reservedForResponse', () => {
    const cbm = new ContextBudgetManager(10_000, 2_000);
    expect(cbm.maxTokens).toBe(10_000);
    expect(cbm.reservedForResponse).toBe(2_000);
  });
});
