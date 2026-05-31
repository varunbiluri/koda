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

/** Cap oversized tool messages while preserving ref IDs at the start. */
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

export function estimateTokens(messages: Array<{ content?: unknown; tool_calls?: unknown }>): number {
  return Math.ceil(estimateChars(messages) / 4);
}

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

export function peakContextChars(messages: Array<{ content?: unknown; tool_calls?: unknown }>): number {
  return estimateChars(messages);
}
