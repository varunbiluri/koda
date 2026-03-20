/**
 * DifferentiationDisplay — unit tests
 */

import { describe, it, expect } from 'vitest';
import { DifferentiationDisplay } from '../../src/product/differentiation.js';

describe('DifferentiationDisplay.format', () => {
  it('returns empty string when nothing notable happened', () => {
    const out = DifferentiationDisplay.format({
      firstAttemptSuccess:  true,
      retries:              0,
      filesChanged:         1,
      verified:             false,
      impactAnalysisRan:    false,
      usedPriorLearning:    false,
    });
    expect(out).toBe('');
  });

  it('mentions self-correction when retries > 0', () => {
    const out = DifferentiationDisplay.format({
      firstAttemptSuccess:  false,
      retries:              2,
      filesChanged:         1,
      verified:             true,
      impactAnalysisRan:    false,
      usedPriorLearning:    false,
    });
    expect(out).toContain('Self-corrected 2x');
  });

  it('mentions verification when first attempt succeeded', () => {
    const out = DifferentiationDisplay.format({
      firstAttemptSuccess:  true,
      retries:              0,
      filesChanged:         1,
      verified:             true,
      impactAnalysisRan:    false,
      usedPriorLearning:    false,
    });
    expect(out).toContain('Verified automatically');
  });

  it('mentions impact analysis when multiple files changed', () => {
    const out = DifferentiationDisplay.format({
      firstAttemptSuccess:  true,
      retries:              0,
      filesChanged:         5,
      verified:             false,
      impactAnalysisRan:    true,
      usedPriorLearning:    false,
    });
    expect(out).toContain('Impact-aware');
  });

  it('mentions learning when prior sessions were used', () => {
    const out = DifferentiationDisplay.format({
      firstAttemptSuccess:  true,
      retries:              0,
      filesChanged:         1,
      verified:             false,
      impactAnalysisRan:    false,
      usedPriorLearning:    true,
    });
    expect(out).toContain('Learning applied');
  });
});

describe('DifferentiationDisplay.timeSavedMessage', () => {
  it('returns a non-empty string', () => {
    const msg = DifferentiationDisplay.timeSavedMessage(15_000, 1);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toContain('15.0s');
  });
});
