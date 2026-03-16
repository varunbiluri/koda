/**
 * ContextSummarizer — summarises the middle portion of loop messages
 * when the reasoning loop accumulates too many rounds.
 *
 * Distinct from ConversationSummarizer (which compresses multi-turn
 * chat history between user sessions).  This module operates inside
 * a single reasoning loop execution and keeps the active message list
 * within a safe length.
 *
 * Strategy:
 *   - Trigger when loopMessages.length > LOOP_SUMMARIZE_THRESHOLD (40)
 *   - Keep: system message (index 0) + newest LOOP_KEEP_RECENT messages
 *   - Summarise: the middle messages via a single LLM call
 *   - Replace the middle slice with one assistant message containing
 *     the summary, prefixed with "[Loop summary]"
 */

import type { AIProvider, ChatMessage } from '../types.js';
import { logger } from '../../utils/logger.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Trigger summarisation when loop messages exceed this count. */
export const LOOP_SUMMARIZE_THRESHOLD = 40;

/** Number of recent messages to keep verbatim after summarisation. */
export const LOOP_KEEP_RECENT = 10;

/** Maximum tokens allocated for the summarisation LLM call. */
const SUMMARY_MAX_TOKENS = 500;

// ── ContextSummarizer ────────────────────────────────────────────────────────

export class ContextSummarizer {
  constructor(private readonly provider: AIProvider) {}

  /**
   * Returns true when `messages` should be summarised.
   * The system message at index 0 does not count toward the threshold.
   */
  shouldSummarise(messages: ChatMessage[]): boolean {
    return messages.length > LOOP_SUMMARIZE_THRESHOLD;
  }

  /**
   * Summarise the middle portion of `messages` and return a new, shorter
   * array with a single "[Loop summary]" message replacing the middle.
   *
   * If the LLM call fails, the original array is returned unchanged so the
   * loop can continue without crashing.
   *
   * @param messages - Full loop message list (including system message).
   */
  async summarise(messages: ChatMessage[]): Promise<ChatMessage[]> {
    if (messages.length <= LOOP_SUMMARIZE_THRESHOLD) return messages;

    // Identify which messages to summarise: everything between the system
    // message and the most recent LOOP_KEEP_RECENT messages.
    const systemMsg    = messages[0];
    const recentMsgs   = messages.slice(-LOOP_KEEP_RECENT);
    const middleMsgs   = messages.slice(1, messages.length - LOOP_KEEP_RECENT);

    if (middleMsgs.length === 0) return messages;

    const middleText = middleMsgs
      .map((m) => {
        const role    = m.role.toUpperCase();
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `[${role}]: ${content.slice(0, 500)}`;
      })
      .join('\n---\n');

    const summaryPrompt = [
      'Summarise the following reasoning loop messages in 3–5 bullet points.',
      'Focus on: what was explored, what was found, what was changed.',
      'Be concise — max 400 words.',
      '',
      middleText,
    ].join('\n');

    let summaryText = '';

    try {
      const response = await this.provider.sendChatCompletion({
        messages: [
          { role: 'system',  content: 'You are a concise technical summariser.' },
          { role: 'user',    content: summaryPrompt },
        ],
        temperature: 0.0,
        max_tokens:  SUMMARY_MAX_TOKENS,
      });
      summaryText = response.choices[0]?.message?.content ?? '';
    } catch (err) {
      logger.warn(`[context-summarizer] LLM summarisation failed — keeping original: ${(err as Error).message}`);
      return messages;
    }

    if (!summaryText) return messages;

    const summaryMessage: ChatMessage = {
      role:    'assistant',
      content: `[Loop summary]\n${summaryText}`,
    };

    const result = [systemMsg, summaryMessage, ...recentMsgs];
    logger.debug(
      `[context-summarizer] Compressed ${messages.length} → ${result.length} messages ` +
      `(summarised ${middleMsgs.length} middle messages)`,
    );

    return result;
  }
}
