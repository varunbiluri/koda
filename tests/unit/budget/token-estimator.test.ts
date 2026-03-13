import { describe, it, expect } from 'vitest';
import { TokenEstimator } from '../../../src/budget/token-estimator.js';

describe('TokenEstimator', () => {
  const estimator = new TokenEstimator();

  describe('estimateTokens', () => {
    it('should estimate tokens from text', () => {
      const text = 'This is a test message';
      const tokens = estimator.estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(Math.ceil(text.length / 4));
    });

    it('should handle empty string', () => {
      const tokens = estimator.estimateTokens('');
      expect(tokens).toBe(0);
    });

    it('should estimate more tokens for longer text', () => {
      const shortText = 'Hello';
      const longText = 'Hello world this is a much longer message';

      const shortTokens = estimator.estimateTokens(shortText);
      const longTokens = estimator.estimateTokens(longText);

      expect(longTokens).toBeGreaterThan(shortTokens);
    });
  });

  describe('estimateTokensFromMessages', () => {
    it('should estimate tokens from message array', () => {
      const messages = [
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'assistant', content: 'I am doing well, thank you!' },
      ];

      const tokens = estimator.estimateTokensFromMessages(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should include overhead for message structure', () => {
      const messages = [{ role: 'user', content: 'Test' }];

      const tokens = estimator.estimateTokensFromMessages(messages);
      const contentOnlyTokens = estimator.estimateTokens('Test');

      // Should be more than just content due to role overhead
      expect(tokens).toBeGreaterThan(contentOnlyTokens);
    });

    it('should handle empty messages array', () => {
      const tokens = estimator.estimateTokensFromMessages([]);
      expect(tokens).toBe(0);
    });
  });

  describe('wouldExceedLimit', () => {
    it('should return false when within limit', () => {
      const text = 'Short message';
      const currentUsage = 100;
      const limit = 1000;

      const wouldExceed = estimator.wouldExceedLimit(text, currentUsage, limit);
      expect(wouldExceed).toBe(false);
    });

    it('should return true when would exceed limit', () => {
      const text = 'a'.repeat(1000); // ~250 tokens
      const currentUsage = 900;
      const limit = 1000;

      const wouldExceed = estimator.wouldExceedLimit(text, currentUsage, limit);
      expect(wouldExceed).toBe(true);
    });

    it('should handle exact limit', () => {
      const text = 'test';
      const tokens = estimator.estimateTokens(text);
      const currentUsage = 1000 - tokens;
      const limit = 1000;

      const wouldExceed = estimator.wouldExceedLimit(text, currentUsage, limit);
      expect(wouldExceed).toBe(false);
    });
  });

  describe('truncateToFit', () => {
    it('should not truncate if within limit', () => {
      const text = 'This is a short message';
      const maxTokens = 100;

      const truncated = estimator.truncateToFit(text, maxTokens);
      expect(truncated).toBe(text);
    });

    it('should truncate and add ellipsis if exceeds limit', () => {
      const text = 'a'.repeat(1000);
      const maxTokens = 10;

      const truncated = estimator.truncateToFit(text, maxTokens);

      expect(truncated.length).toBeLessThan(text.length);
      expect(truncated.endsWith('...')).toBe(true);
    });

    it('should truncate to approximately correct token count', () => {
      const text = 'a'.repeat(1000);
      const maxTokens = 50;

      const truncated = estimator.truncateToFit(text, maxTokens);
      const truncatedTokens = estimator.estimateTokens(truncated);

      expect(truncatedTokens).toBeLessThanOrEqual(maxTokens);
    });

    it('should handle very small limits', () => {
      const text = 'This is a test';
      const maxTokens = 1;

      const truncated = estimator.truncateToFit(text, maxTokens);

      expect(truncated.endsWith('...')).toBe(true);
      expect(truncated.length).toBeLessThanOrEqual(4); // maxTokens * 4 chars
    });
  });

  describe('getRemainingTokens', () => {
    it('should return correct remaining tokens', () => {
      const currentUsage = 300;
      const limit = 1000;

      const remaining = estimator.getRemainingTokens(currentUsage, limit);
      expect(remaining).toBe(700);
    });

    it('should return 0 when at limit', () => {
      const currentUsage = 1000;
      const limit = 1000;

      const remaining = estimator.getRemainingTokens(currentUsage, limit);
      expect(remaining).toBe(0);
    });

    it('should return 0 when over limit', () => {
      const currentUsage = 1200;
      const limit = 1000;

      const remaining = estimator.getRemainingTokens(currentUsage, limit);
      expect(remaining).toBe(0);
    });
  });
});
