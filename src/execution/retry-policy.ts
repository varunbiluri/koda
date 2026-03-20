/**
 * RetryPolicy — exponential backoff utility for transient failures.
 *
 * Used by GraphScheduler to add delay between node retries, and as a
 * general-purpose resilience primitive for any component that needs
 * fault-tolerant execution.
 *
 * Retry semantics:
 *   - Permanent errors (permission denied, syntax error, unknown tool) are
 *     NOT retried — retrying them wastes time and budget.
 *   - Transient errors (network, timeout, rate limit) are retried with
 *     exponential backoff: baseDelay × 2^(attempt-1), capped at maxDelay.
 */

import { logger } from '../utils/logger.js';

// ── Permanent-failure patterns ────────────────────────────────────────────────

/**
 * Error messages matching these patterns indicate stable failures.
 * executeWithRetry will re-throw immediately without any backoff.
 */
const PERMANENT_ERROR_PATTERNS: RegExp[] = [
  /permission denied/i,
  /path escapes repository root/i,
  /unknown tool/i,
  /syntax error/i,
  /cannot find module/i,
  /is blocked by security policy/i,
  /denied by user/i,
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /**
   * Total number of attempts (1 = no retries; 3 = first try + up to 2 retries).
   * Default: 3.
   */
  maxAttempts?: number;
  /**
   * Base delay in milliseconds before the first retry.
   * Each subsequent retry doubles the delay. Default: 500.
   */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds. Default: 8 000. */
  maxDelayMs?: number;
  /**
   * Predicate deciding whether an error is retryable.
   * Default: isTransientError (blocks on permanent error patterns).
   */
  isRetryable?: (err: Error) => boolean;
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Execute `fn` with exponential backoff retries.
 *
 * Only transient errors are retried. Permanent errors (permission denied,
 * syntax errors, etc.) propagate immediately regardless of `maxAttempts`.
 *
 * @param fn      - Async function to execute.
 * @param label   - Identifier used in log messages (e.g. node ID).
 * @param opts    - Retry configuration.
 * @param onRetry - Called before each retry with the attempt number, computed
 *                  delay, and the triggering error.
 */
export async function executeWithRetry<T>(
  fn:       () => Promise<T>,
  label:    string,
  opts:     RetryOptions = {},
  onRetry?: (attempt: number, delayMs: number, err: Error) => void,
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs  = 8_000,
    isRetryable = isTransientError,
  } = opts;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;

      // Permanent failures propagate immediately — no backoff
      if (!isRetryable(lastError)) {
        logger.debug(
          `[retry-policy] PERMANENT label=${label} attempt=${attempt} ` +
          `error="${lastError.message.slice(0, 100)}" — not retrying`,
        );
        throw lastError;
      }

      // Exhausted all attempts
      if (attempt >= maxAttempts) {
        throw lastError;
      }

      const delayMs = backoffDelayMs(attempt, baseDelayMs, maxDelayMs);
      logger.warn(
        `[retry-policy] RETRY label=${label} attempt=${attempt}/${maxAttempts} ` +
        `delay=${delayMs}ms error="${lastError.message.slice(0, 100)}"`,
      );
      onRetry?.(attempt, delayMs, lastError);
      await sleep(delayMs);
    }
  }

  // Unreachable — satisfies TypeScript's control-flow analysis
  throw lastError ?? new Error('[retry-policy] executeWithRetry: unexpected exit');
}

/**
 * Returns true when the error is likely transient and worth retrying.
 *
 * Matches the complement of PERMANENT_ERROR_PATTERNS — anything not
 * explicitly permanent is assumed to be potentially transient.
 */
export function isTransientError(err: Error): boolean {
  return !PERMANENT_ERROR_PATTERNS.some((p) => p.test(err.message));
}

/**
 * Compute exponential backoff delay for a given attempt number (1-indexed).
 *
 * Exported so callers (e.g. GraphScheduler) can compute delays without
 * going through executeWithRetry.
 *
 * @param attempt     - Attempt number (1 = first retry).
 * @param baseDelayMs - Base delay in milliseconds (default 500).
 * @param maxDelayMs  - Cap on the computed delay (default 8 000).
 */
export function backoffDelayMs(
  attempt:    number,
  baseDelayMs = 500,
  maxDelayMs  = 8_000,
): number {
  return Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
}

/** Promisified setTimeout — resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
