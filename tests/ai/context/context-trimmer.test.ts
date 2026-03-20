/**
 * Tests for context-trimmer utilities.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  trimMessages,
  estimateChars,
  estimateTokens,
  SOFT_LIMIT_CHARS,
  DEFAULT_KEEP_RECENT,
} from '../../../src/ai/context/context-trimmer.js';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function msg(role: string, content: string) {
  return { role, content };
}

function bigMsg(role: string, chars: number) {
  return msg(role, 'x'.repeat(chars));
}

// ── trimMessages ──────────────────────────────────────────────────────────────

describe('trimMessages', () => {
  it('returns messages unchanged when under the soft limit', () => {
    const messages = [
      msg('system', 'You are Koda.'),
      msg('user',   'hello'),
      msg('assistant', 'hi'),
    ];
    const result = trimMessages(messages);
    expect(result.trimmed).toBe(false);
    expect(result.droppedCount).toBe(0);
    expect(result.messages).toBe(messages); // same reference
  });

  it('trims oldest conversation turns when over the soft limit', () => {
    // Create a big message list that exceeds 80k chars
    const messages = [
      msg('system', 'system prompt'),
      ...Array.from({ length: 20 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(5_000))),
    ];
    const result = trimMessages(messages, { keepRecentCount: 5 });

    expect(result.trimmed).toBe(true);
    expect(result.droppedCount).toBeGreaterThan(0);
    // System message is always kept
    expect(result.messages[0].role).toBe('system');
    // Only keepRecentCount non-system messages retained
    const nonSystem = result.messages.filter(m => m.role !== 'system');
    expect(nonSystem.length).toBeLessThanOrEqual(5);
  });

  it('always preserves ALL system messages', () => {
    const messages = [
      msg('system',    'sys1'),
      msg('system',    'sys2'),
      ...Array.from({ length: 20 }, () => bigMsg('user', 5_000)),
    ];
    const result = trimMessages(messages, { keepRecentCount: 2 });

    const systemKept = result.messages.filter(m => m.role === 'system');
    expect(systemKept.length).toBe(2);
    expect(systemKept[0].content).toBe('sys1');
    expect(systemKept[1].content).toBe('sys2');
  });

  it('retains the DEFAULT_KEEP_RECENT most-recent messages by default', () => {
    const messages = [
      msg('system', 'sys'),
      ...Array.from({ length: 30 }, (_, i) => msg('user', `msg-${i} ${'x'.repeat(3_500)}`)),
    ];
    const result = trimMessages(messages);

    expect(result.trimmed).toBe(true);
    const nonSystem = result.messages.filter(m => m.role !== 'system');
    expect(nonSystem.length).toBeLessThanOrEqual(DEFAULT_KEEP_RECENT);
    // Last message in the original set is the last kept
    const lastOriginal = messages[messages.length - 1];
    expect(result.messages[result.messages.length - 1]).toBe(lastOriginal);
  });

  it('respects a custom softLimitChars threshold', () => {
    const messages = [
      msg('system', 'sys'),
      msg('user', 'x'.repeat(100)),
      msg('assistant', 'y'.repeat(100)),
    ];
    // Set a tiny limit to force trimming
    const result = trimMessages(messages, { softLimitChars: 50, keepRecentCount: 1 });

    expect(result.trimmed).toBe(true);
  });

  it('returns estimatedTokens for the trimmed message list', () => {
    const messages = [
      msg('system', 'sys'),
      ...Array.from({ length: 20 }, () => bigMsg('user', 6_000)),
    ];
    const result = trimMessages(messages, { keepRecentCount: 3 });

    expect(result.estimatedTokens).toBeGreaterThan(0);
    // Tokens after trim should be less than before trim
    const beforeTokens = estimateTokens(messages);
    expect(result.estimatedTokens).toBeLessThan(beforeTokens);
  });

  it('handles an empty message list gracefully', () => {
    const result = trimMessages([]);
    expect(result.trimmed).toBe(false);
    expect(result.messages).toEqual([]);
    expect(result.droppedCount).toBe(0);
  });

  it('handles a list with only system messages', () => {
    const messages = [
      msg('system', 'x'.repeat(100_000)), // huge system message
    ];
    const result = trimMessages(messages, { keepRecentCount: 5 });
    // System messages are always kept — even if they alone exceed the limit
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('system');
  });
});

// ── estimateChars ─────────────────────────────────────────────────────────────

describe('estimateChars', () => {
  it('sums string content lengths', () => {
    const messages = [
      msg('system', 'hello'),  // 5 chars
      msg('user',   'world!'), // 6 chars
    ];
    expect(estimateChars(messages)).toBe(11);
  });

  it('returns 0 for messages without content', () => {
    const messages = [{ role: 'assistant' }]; // no content field
    expect(estimateChars(messages)).toBe(0);
  });

  it('handles array-style content parts', () => {
    const messages = [
      { role: 'user', content: [{ text: 'hello' }, { text: ' world' }] },
    ];
    expect(estimateChars(messages)).toBe(11);
  });
});

// ── estimateTokens ────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns ceil(chars / 4)', () => {
    const messages = [msg('user', 'x'.repeat(400))];
    expect(estimateTokens(messages)).toBe(100);
  });

  it('rounds up for non-divisible lengths', () => {
    const messages = [msg('user', 'x'.repeat(5))]; // 5 / 4 = 1.25 → ceil = 2
    expect(estimateTokens(messages)).toBe(2);
  });
});

// ── constants ─────────────────────────────────────────────────────────────────

describe('exported constants', () => {
  it('SOFT_LIMIT_CHARS is a positive number', () => {
    expect(SOFT_LIMIT_CHARS).toBeGreaterThan(0);
  });

  it('DEFAULT_KEEP_RECENT is a positive number', () => {
    expect(DEFAULT_KEEP_RECENT).toBeGreaterThan(0);
  });
});
