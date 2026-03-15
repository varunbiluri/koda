import { describe, it, expect, vi } from 'vitest';
import type { AIProvider, ChatCompletionResponse, ChatMessage } from '../../src/ai/types.js';
import { compressHistory } from '../../src/ai/context/conversation-summarizer.js';

function makeProvider(summaryText = 'Summary of the conversation.'): AIProvider {
  const response: ChatCompletionResponse = {
    id: 'test',
    choices: [{ index: 0, message: { role: 'assistant', content: summaryText }, finish_reason: 'stop' }],
  };
  return {
    sendChatCompletion: vi.fn().mockResolvedValue(response),
    streamChatCompletion: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
  };
}

function makeHistory(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `Message ${i + 1}`,
  }));
}

describe('compressHistory', () => {
  it('returns history unchanged when 20 or fewer messages', async () => {
    const history = makeHistory(20);
    const provider = makeProvider();

    const result = await compressHistory(history, provider);

    expect(result).toHaveLength(20);
    expect(provider.sendChatCompletion).not.toHaveBeenCalled();
  });

  it('compresses history when more than 20 messages', async () => {
    const history = makeHistory(25);
    const provider = makeProvider('Discussed auth and added tests.');

    const result = await compressHistory(history, provider);

    // 25 messages - 10 summarized + 1 summary message = 16
    expect(result.length).toBeLessThan(25);
    expect(provider.sendChatCompletion).toHaveBeenCalledOnce();
  });

  it('inserts a system summary message at the start', async () => {
    const history = makeHistory(22);
    const provider = makeProvider('Fixed the login bug.');

    const result = await compressHistory(history, provider);

    expect(result[0].role).toBe('system');
    expect(result[0].content).toContain('Previous conversation summary:');
    expect(result[0].content).toContain('Fixed the login bug.');
  });

  it('preserves the newest messages after the summary', async () => {
    const history = makeHistory(25);
    const provider = makeProvider();

    const result = await compressHistory(history, provider);

    // The last message of the original history should still be present
    const lastOriginal = history[24];
    const lastCompressed = result[result.length - 1];
    expect(lastCompressed.content).toBe(lastOriginal.content);
  });

  it('falls back gracefully when AI provider throws', async () => {
    const history = makeHistory(22);
    const provider = makeProvider();
    (provider.sendChatCompletion as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error'),
    );

    // Should not throw — fallback to truncated transcript
    const result = await compressHistory(history, provider);

    expect(result[0].role).toBe('system');
    expect(result[0].content).toContain('Previous conversation summary:');
  });
});
