/**
 * Tests for retry-policy utilities.
 *
 * Uses fake timers so the test suite is fast even with large backoff values.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeWithRetry,
  isTransientError,
  backoffDelayMs,
} from '../../src/execution/retry-policy.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── executeWithRetry ──────────────────────────────────────────────────────────

describe('executeWithRetry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves immediately when the first attempt succeeds', async () => {
    const fn = vi.fn().mockResolvedValueOnce('ok');
    const result = await executeWithRetry(fn, 'test');
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a transient error and succeeds on the second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce('recovered');

    const promise = executeWithRetry(fn, 'test', { maxAttempts: 3, baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting maxAttempts', async () => {
    // Use real (tiny) delays so no unhandled-rejection races with fake timers
    vi.useRealTimers();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'));

    await expect(
      executeWithRetry(fn, 'test', { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 5 }),
    ).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useFakeTimers();
  });

  it('does NOT retry permanent errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permission denied'));
    await expect(executeWithRetry(fn, 'test', { maxAttempts: 5 })).rejects.toThrow('permission denied');
    // Single attempt only — no retries for permanent errors
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry path-escape errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('path escapes repository root'));
    await expect(executeWithRetry(fn, 'test', { maxAttempts: 3 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry syntax errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('syntax error near line 42'));
    await expect(executeWithRetry(fn, 'test', { maxAttempts: 3 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry with attempt, delay, and error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('done');

    const onRetry = vi.fn();
    const promise = executeWithRetry(fn, 'test', { maxAttempts: 3, baseDelayMs: 200 }, onRetry);
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, 200, expect.any(Error));
  });

  it('respects a custom isRetryable predicate', async () => {
    // Only retry errors containing "flaky"
    const fn = vi.fn().mockRejectedValue(new Error('stable failure'));
    await expect(
      executeWithRetry(fn, 'test', {
        maxAttempts: 3,
        isRetryable: (e) => e.message.includes('flaky'),
      }),
    ).rejects.toThrow('stable failure');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('maxAttempts=1 means no retries at all', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('oops'));
    await expect(executeWithRetry(fn, 'test', { maxAttempts: 1 })).rejects.toThrow('oops');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── isTransientError ──────────────────────────────────────────────────────────

describe('isTransientError', () => {
  it('returns true for generic / network errors', () => {
    expect(isTransientError(new Error('connection reset by peer'))).toBe(true);
    expect(isTransientError(new Error('rate limit exceeded'))).toBe(true);
    expect(isTransientError(new Error('service temporarily unavailable'))).toBe(true);
  });

  it('returns false for permission denied', () => {
    expect(isTransientError(new Error('permission denied'))).toBe(false);
  });

  it('returns false for path escape errors', () => {
    expect(isTransientError(new Error('path escapes repository root: "../secret"'))).toBe(false);
  });

  it('returns false for syntax errors', () => {
    expect(isTransientError(new Error('syntax error at line 10'))).toBe(false);
  });

  it('returns false for unknown tool errors', () => {
    expect(isTransientError(new Error('unknown tool: foo_bar'))).toBe(false);
  });

  it('returns false for cannot find module', () => {
    expect(isTransientError(new Error('cannot find module "foo"'))).toBe(false);
  });
});

// ── backoffDelayMs ────────────────────────────────────────────────────────────

describe('backoffDelayMs', () => {
  it('returns baseDelayMs for attempt 1', () => {
    expect(backoffDelayMs(1, 500)).toBe(500);
  });

  it('doubles on each subsequent attempt', () => {
    expect(backoffDelayMs(2, 500)).toBe(1_000);
    expect(backoffDelayMs(3, 500)).toBe(2_000);
    expect(backoffDelayMs(4, 500)).toBe(4_000);
  });

  it('caps at maxDelayMs', () => {
    expect(backoffDelayMs(10, 500, 4_000)).toBe(4_000);
  });

  it('uses defaults when no arguments are provided', () => {
    // baseDelayMs=500, maxDelayMs=8000
    expect(backoffDelayMs(1)).toBe(500);
    expect(backoffDelayMs(5)).toBe(8_000); // 500*16 = 8000, capped
  });
});
