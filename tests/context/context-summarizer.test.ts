/**
 * Tests for ContextSummarizer.
 *
 * LLM calls are mocked so tests are fast and deterministic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ContextSummarizer,
  LOOP_SUMMARIZE_THRESHOLD,
  LOOP_KEEP_RECENT,
} from '../../src/ai/context/context-summarizer.js';
import type { AIProvider, ChatMessage } from '../../src/ai/types.js';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function makeMockProvider(summaryText = 'Summary of loop messages.'): AIProvider {
  return {
    sendChatCompletion: vi.fn().mockResolvedValue({
      choices: [{ message: { content: summaryText } }],
    }),
  } as unknown as AIProvider;
}

function makeMessages(count: number): ChatMessage[] {
  const msgs: ChatMessage[] = [
    { role: 'system', content: 'You are Koda.' },
  ];
  for (let i = 1; i < count; i++) {
    msgs.push({
      role:    i % 2 === 0 ? 'assistant' : 'user',
      content: `Message ${i}`,
    });
  }
  return msgs;
}

// ── Tests: shouldSummarise ─────────────────────────────────────────────────────

describe('ContextSummarizer.shouldSummarise()', () => {
  let summarizer: ContextSummarizer;

  beforeEach(() => {
    summarizer = new ContextSummarizer(makeMockProvider());
  });

  it('returns false when messages <= LOOP_SUMMARIZE_THRESHOLD', () => {
    const msgs = makeMessages(LOOP_SUMMARIZE_THRESHOLD);
    expect(summarizer.shouldSummarise(msgs)).toBe(false);
  });

  it('returns true when messages > LOOP_SUMMARIZE_THRESHOLD', () => {
    const msgs = makeMessages(LOOP_SUMMARIZE_THRESHOLD + 1);
    expect(summarizer.shouldSummarise(msgs)).toBe(true);
  });

  it('returns false for empty array', () => {
    expect(summarizer.shouldSummarise([])).toBe(false);
  });
});

// ── Tests: summarise ──────────────────────────────────────────────────────────

describe('ContextSummarizer.summarise()', () => {
  const SUMMARY_TEXT = '• Explored src/auth\n• Found AuthService\n• Added JWT method';

  it('returns original messages when at or below threshold', async () => {
    const summarizer = new ContextSummarizer(makeMockProvider(SUMMARY_TEXT));
    const msgs       = makeMessages(LOOP_SUMMARIZE_THRESHOLD);
    const result     = await summarizer.summarise(msgs);
    expect(result).toBe(msgs);
  });

  it('compresses messages above threshold', async () => {
    const summarizer = new ContextSummarizer(makeMockProvider(SUMMARY_TEXT));
    const msgs       = makeMessages(LOOP_SUMMARIZE_THRESHOLD + 10);
    const result     = await summarizer.summarise(msgs);
    expect(result.length).toBeLessThan(msgs.length);
  });

  it('preserves the system message at index 0', async () => {
    const summarizer = new ContextSummarizer(makeMockProvider(SUMMARY_TEXT));
    const msgs       = makeMessages(LOOP_SUMMARIZE_THRESHOLD + 5);
    const result     = await summarizer.summarise(msgs);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('You are Koda.');
  });

  it('keeps LOOP_KEEP_RECENT messages verbatim at the end', async () => {
    const summarizer  = new ContextSummarizer(makeMockProvider(SUMMARY_TEXT));
    const total       = LOOP_SUMMARIZE_THRESHOLD + 5;
    const msgs        = makeMessages(total);
    const result      = await summarizer.summarise(msgs);
    const originalEnd = msgs.slice(-LOOP_KEEP_RECENT);
    const resultEnd   = result.slice(-LOOP_KEEP_RECENT);
    expect(resultEnd).toEqual(originalEnd);
  });

  it('inserts a [Loop summary] assistant message', async () => {
    const summarizer = new ContextSummarizer(makeMockProvider(SUMMARY_TEXT));
    const msgs       = makeMessages(LOOP_SUMMARIZE_THRESHOLD + 5);
    const result     = await summarizer.summarise(msgs);
    const summaryMsg = result.find((m) =>
      typeof m.content === 'string' && m.content.startsWith('[Loop summary]'),
    );
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg?.role).toBe('assistant');
    expect(summaryMsg?.content).toContain(SUMMARY_TEXT);
  });

  it('returns original messages when LLM fails', async () => {
    const failProvider: AIProvider = {
      sendChatCompletion: vi.fn().mockRejectedValue(new Error('LLM error')),
    } as unknown as AIProvider;
    const summarizer = new ContextSummarizer(failProvider);
    const msgs       = makeMessages(LOOP_SUMMARIZE_THRESHOLD + 5);
    const result     = await summarizer.summarise(msgs);
    expect(result).toBe(msgs);
  });

  it('returns original messages when LLM returns empty content', async () => {
    const summarizer = new ContextSummarizer(makeMockProvider(''));
    const msgs       = makeMessages(LOOP_SUMMARIZE_THRESHOLD + 5);
    const result     = await summarizer.summarise(msgs);
    expect(result).toBe(msgs);
  });

  it('final message count = 1 (system) + 1 (summary) + LOOP_KEEP_RECENT', async () => {
    const summarizer = new ContextSummarizer(makeMockProvider(SUMMARY_TEXT));
    const msgs       = makeMessages(LOOP_SUMMARIZE_THRESHOLD + 10);
    const result     = await summarizer.summarise(msgs);
    expect(result.length).toBe(1 + 1 + LOOP_KEEP_RECENT);
  });
});
