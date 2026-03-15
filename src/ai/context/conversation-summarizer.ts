import type { AIProvider, ChatMessage } from '../types.js';

const COMPRESSION_THRESHOLD = 20; // compress when history exceeds this many messages
const MESSAGES_TO_SUMMARIZE = 10; // oldest N messages to collapse into a summary

/**
 * If the conversation history is longer than COMPRESSION_THRESHOLD messages,
 * summarize the oldest MESSAGES_TO_SUMMARIZE into a single system message and
 * return the compressed array.  Otherwise return the history unchanged.
 *
 * @param onStage - Optional callback for UI progress messages (structured label format).
 */
export async function compressHistory(
  history: ChatMessage[],
  provider: AIProvider,
  onStage?: (message: string) => void,
): Promise<ChatMessage[]> {
  if (history.length <= COMPRESSION_THRESHOLD) {
    return history;
  }

  onStage?.('INFO Compressing conversation history');

  const toSummarize = history.slice(0, MESSAGES_TO_SUMMARIZE);
  const remaining = history.slice(MESSAGES_TO_SUMMARIZE);

  const summaryText = await buildSummary(toSummarize, provider);
  onStage?.('WARN Context compressed — older messages summarized');

  const summaryMessage: ChatMessage = {
    role: 'system',
    content: `Previous conversation summary: ${summaryText}`,
  };

  return [summaryMessage, ...remaining];
}

async function buildSummary(
  messages: ChatMessage[],
  provider: AIProvider,
): Promise<string> {
  const transcript = messages
    .filter((m) => m.content)
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n');

  try {
    const response = await provider.sendChatCompletion({
      messages: [
        {
          role: 'system',
          content:
            'You are a conversation summarizer. Produce a concise (3–5 sentence) summary of the following conversation transcript. Focus on decisions made, files changed, and open questions.',
        },
        { role: 'user', content: transcript },
      ],
      temperature: 0.2,
      max_tokens: 300,
    });
    return response.choices[0]?.message?.content ?? transcript.slice(0, 500);
  } catch {
    // If summarization fails, fall back to a truncated transcript
    return transcript.slice(0, 500) + (transcript.length > 500 ? '...' : '');
  }
}
