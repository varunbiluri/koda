import { logger } from '../../utils/logger.js';
import type { ChatCompletionStreamChunk } from '../types.js';

/** Parse OpenAI-compatible SSE stream and invoke onChunk for each text delta. */
export async function consumeOpenAiSseStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const chunk: ChatCompletionStreamChunk = JSON.parse(trimmed.slice(6));
          const content = chunk.choices[0]?.delta?.content;
          if (content) onChunk(content);
        } catch {
          logger.warn(`Failed to parse SSE chunk: ${trimmed}`);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
