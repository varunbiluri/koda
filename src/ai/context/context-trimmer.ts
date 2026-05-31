/**
 * ContextTrimmer — stateless message-list trimming for LLM context management.
 */

import { logger } from '../../utils/logger.js';

export const SOFT_LIMIT_CHARS = 80_000;
export const DEFAULT_KEEP_RECENT = 10;

/** Max chars for tool-role messages after reference injection (safety cap). */
export const MAX_TOOL_MESSAGE_CHARS = 800;

export interface TrimOptions {
  softLimitChars?:  number;
  keepRecentCount?: number;
}

export interface TrimResult<T> {
  messages:        T[];
  trimmed:         boolean;
  droppedCount:    number;
  estimatedTokens: number;
}

/**
 * Trim a chat message list to fit within a soft character budget while preserving all system messages and the most recent non-system messages.
 *
 * @param messages - Array of chat messages; each item must have a `role` string and may include `content` and `tool_calls`.
 * @param opts - Optional trimming configuration. `softLimitChars` overrides the character budget; `keepRecentCount` sets how many non-system messages to retain.
 * @returns An object containing the resulting `messages`, `trimmed` (whether trimming occurred), `droppedCount` (number of non-system messages removed), and `estimatedTokens` (token estimate for the returned messages).
 */
export function trimMessages<T extends { role: string; content?: unknown; tool_calls?: unknown }>(
  messages: T[],
  opts:     TrimOptions = {},
): TrimResult<T> {
  const {
    softLimitChars  = SOFT_LIMIT_CHARS,
    keepRecentCount = DEFAULT_KEEP_RECENT,
  } = opts;

  const capped = capToolMessages(messages);
  const totalChars      = estimateChars(capped);
  const estimatedBefore = Math.ceil(totalChars / 4);

  if (totalChars <= softLimitChars) {
    logger.debug(
      `[context-trimmer] context OK estimatedTokens=${estimatedBefore} messages=${capped.length} — no trim`,
    );
    return {
      messages:        capped,
      trimmed:         false,
      droppedCount:    0,
      estimatedTokens: estimatedBefore,
    };
  }

  const systemMsgs = capped.filter((m) => m.role === 'system');
  const convMsgs   = capped.filter((m) => m.role !== 'system');
  const kept       = convMsgs.slice(-keepRecentCount);
  const dropped    = convMsgs.length - kept.length;
  const result     = [...systemMsgs, ...kept] as T[];
  const estimatedAfter = Math.ceil(estimateChars(result) / 4);

  logger.debug(
    `[context-trimmer] TRIM trimmed=true ` +
    `before=${estimatedBefore}tok after=${estimatedAfter}tok ` +
    `dropped=${dropped} kept_system=${systemMsgs.length} kept_recent=${kept.length}`,
  );

  return {
    messages:        result,
    trimmed:         true,
    droppedCount:    dropped,
    estimatedTokens: estimatedAfter,
  };
}

/**
 * Truncates overly long `tool`-role message content while preserving a leading reference tag.
 *
 * If a `tool` message's `content` is a string longer than `MAX_TOOL_MESSAGE_CHARS`, a leading
 * reference of the form `[result_<number>]` (if present) is kept, the remainder is truncated so
 * the total length does not exceed `MAX_TOOL_MESSAGE_CHARS`, and the suffix `…[truncated]` is appended.
 * Messages that are not `tool` role or whose `content` is not an oversized string are left unchanged.
 *
 * @returns The original `messages` array if no truncation was necessary; otherwise a new array
 *          with modified `tool` messages whose `content` values were truncated.
 */
export function capToolMessages<T extends { role: string; content?: unknown }>(
  messages: T[],
): T[] {
  let changed = false;
  const out = messages.map((msg) => {
    if (msg.role !== 'tool') return msg;
    const c = msg.content;
    if (typeof c !== 'string' || c.length <= MAX_TOOL_MESSAGE_CHARS) return msg;
    changed = true;
    const refMatch = c.match(/^\[(result_\d+)\]/);
    const refTag   = refMatch ? `[${refMatch[1]}] ` : '';
    return {
      ...msg,
      content: refTag + c.slice(0, MAX_TOOL_MESSAGE_CHARS - refTag.length) + '…[truncated]',
    } as T;
  });
  return changed ? out : messages;
}

/**
 * Estimates the total character count contributed by an array of messages.
 *
 * @param messages - Messages whose `content` and optional `tool_calls` are counted; `content` may be a string or an array of parts with optional `text` fields.
 * @returns The summed character count from message `content` and serialized `tool_calls`.
 */
export function estimateChars(
  messages: Array<{ content?: unknown; tool_calls?: unknown }>,
): number {
  return messages.reduce((sum, msg) => {
    let n = 0;
    const c = msg.content;
    if (typeof c === 'string') n += c.length;
    else if (Array.isArray(c)) {
      n += (c as Array<{ text?: string }>).reduce(
        (s, part) => s + (part?.text?.length ?? 0),
        0,
      );
    }
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      n += JSON.stringify(msg.tool_calls).length;
    }
    return sum + n;
  }, 0);
}

/**
 * Estimate token usage for a list of messages using a heuristic of 4 characters per token.
 *
 * @returns The estimated token count (the ceiling of total characters divided by 4).
 */
export function estimateTokens(messages: Array<{ content?: unknown; tool_calls?: unknown }>): number {
  return Math.ceil(estimateChars(messages) / 4);
}

/**
 * Trim a chat message list to fit the configured soft context budget and return the resulting messages.
 *
 * @param messages - The chat messages to trim; messages with role `'system'` are preserved when trimming, and `tool` messages may be capped before estimating size.
 * @returns The resulting array of messages after trimming (the original array if no trimming was performed).
 */
export function trimContext<T extends { role: string; content?: unknown; tool_calls?: unknown }>(
  messages: T[],
): T[] {
  const result = trimMessages(messages);
  logger.debug({
    tokensEstimated: result.estimatedTokens,
    contextSize:     messages.length,
    trimmed:         result.trimmed,
  });
  return result.messages as T[];
}

/**
 * Estimate the total character count of a list of messages.
 *
 * @param messages - Messages to measure; each item may include `content` (string or array of parts) and/or `tool_calls` (which are stringified and counted)
 * @returns The summed character estimate for all provided messages
 */
export function peakContextChars(messages: Array<{ content?: unknown; tool_calls?: unknown }>): number {
  return estimateChars(messages);
}
