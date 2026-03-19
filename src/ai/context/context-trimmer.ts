/**
 * ContextTrimmer — stateless message-list trimming for LLM context management.
 *
 * This is the single, authoritative place for context eviction.
 * All components that manage message lists should call trimMessages() when the
 * list may exceed the soft limit.  No component should throw or abort solely
 * because a context is large — instead, trim and continue.
 *
 * Algorithm:
 *   1. Estimate total character count of the message list.
 *   2. If under the soft limit, return as-is (fast path).
 *   3. Otherwise: keep every system message + the N most-recent other messages.
 *      Oldest conversation turns are dropped first.
 *
 * Terminology:
 *   characters / 4 ≈ tokens   (conservative 4-chars-per-token heuristic)
 */

import { logger } from '../../utils/logger.js';

// ── Exported constants ────────────────────────────────────────────────────────

/**
 * Default soft character ceiling.
 * ~80k chars / 4 ≈ 20k tokens — well within GPT-4o's 128k context.
 * Trimming kicks in above this to keep each LLM call predictably sized.
 */
export const SOFT_LIMIT_CHARS = 80_000;

/**
 * Default number of most-recent non-system messages to retain after trimming.
 * System messages are always retained regardless of this setting.
 */
export const DEFAULT_KEEP_RECENT = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrimOptions {
  /**
   * Trim when the message list exceeds this character count.
   * Default: SOFT_LIMIT_CHARS (80 000).
   */
  softLimitChars?: number;
  /**
   * Number of most-recent non-system messages to keep after trimming.
   * Default: DEFAULT_KEEP_RECENT (10).
   */
  keepRecentCount?: number;
}

export interface TrimResult<T> {
  messages:        T[];
  /** True if any messages were evicted. */
  trimmed:         boolean;
  /** Number of conversation messages dropped. */
  droppedCount:    number;
  /** Estimated tokens of the returned message list. */
  estimatedTokens: number;
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Trim a message list so it stays within the soft character limit.
 *
 * @param messages - Full message list (system + conversation turns).
 * @param opts     - Optional tuning — soft limit and keep-recent count.
 * @returns TrimResult containing the (possibly shortened) message list.
 */
export function trimMessages<T extends { role: string; content?: unknown }>(
  messages: T[],
  opts:     TrimOptions = {},
): TrimResult<T> {
  const {
    softLimitChars  = SOFT_LIMIT_CHARS,
    keepRecentCount = DEFAULT_KEEP_RECENT,
  } = opts;

  const totalChars      = estimateChars(messages);
  const estimatedBefore = Math.ceil(totalChars / 4);

  if (totalChars <= softLimitChars) {
    logger.debug(
      `[context-trimmer] context OK estimatedTokens=${estimatedBefore} messages=${messages.length} — no trim`,
    );
    return {
      messages,
      trimmed:         false,
      droppedCount:    0,
      estimatedTokens: estimatedBefore,
    };
  }

  // Always keep system messages (they contain identity and constraints).
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const convMsgs   = messages.filter((m) => m.role !== 'system');

  // Retain the N most-recent conversation turns.
  const kept    = convMsgs.slice(-keepRecentCount);
  const dropped = convMsgs.length - kept.length;
  const result  = [...systemMsgs, ...kept] as T[];

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

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Estimate total character count of a message list.
 * Handles string content and OpenAI-style content-part arrays.
 */
export function estimateChars(messages: Array<{ content?: unknown }>): number {
  return messages.reduce((sum, msg) => {
    const c = msg.content;
    if (typeof c === 'string') return sum + c.length;
    if (Array.isArray(c)) {
      return sum + (c as Array<{ text?: string }>).reduce(
        (s, part) => s + (part?.text?.length ?? 0),
        0,
      );
    }
    return sum;
  }, 0);
}

/**
 * Estimate token count from a message list (4 chars/token heuristic).
 * Exported so callers can do a quick size check without calling trimMessages().
 */
export function estimateTokens(messages: Array<{ content?: unknown }>): number {
  return Math.ceil(estimateChars(messages) / 4);
}

// ── Convenience API for LLM calls ─────────────────────────────────────────────
/**
 * Stateless trimming helper for LLM message lists.
 *
 * All LLM calls should pass their messages through this function before
 * hitting the provider. It preserves system prompts, keeps only the most
 * recent conversation turns, and logs compact telemetry for observability.
 */
export function trimContext<T extends { role: string; content?: unknown }>(
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
