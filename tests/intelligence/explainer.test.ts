/**
 * Explainer — unit tests
 */

import { describe, it, expect } from 'vitest';
import { Explainer } from '../../src/intelligence/explainer.js';
import { ConfidenceEngine } from '../../src/intelligence/confidence-engine.js';

describe('Explainer (disabled)', () => {
  it('format() returns empty string when not enabled', () => {
    const ex = new Explainer({ enabled: false });
    ex.recordPlan('SIMPLE', 'reason');
    expect(ex.format()).toBe('');
  });

  it('isEnabled returns false', () => {
    expect(new Explainer({ enabled: false }).isEnabled).toBe(false);
  });
});

describe('Explainer (enabled)', () => {
  it('format() includes plan section', () => {
    const ex = new Explainer({ enabled: true });
    ex.recordPlan('COMPLEX', 'multi-agent needed', ['SIMPLE route rejected']);
    const out = ex.format();
    expect(out).toContain('Routing Decision');
    expect(out).toContain('COMPLEX');
    expect(out).toContain('SIMPLE route rejected');
  });

  it('format() includes fix section', () => {
    const ex = new Explainer({ enabled: true });
    ex.recordFix('compile_error', 'run tsc first', ['guess and pray'], 'learned');
    const out = ex.format();
    expect(out).toContain('Fix Decisions');
    expect(out).toContain('compile_error');
    expect(out).toContain('run tsc first');
    expect(out).toContain('LearningLoop');
  });

  it('format() includes confidence section', () => {
    const ex    = new Explainer({ enabled: true });
    const score = ConfidenceEngine.assess({ retries: 0, verificationPassed: true });
    ex.setConfidence(score);
    const out = ex.format();
    expect(out).toContain('Confidence Assessment');
    expect(out).toContain('HIGH');
  });

  it('format() includes timing section', () => {
    const ex = new Explainer({ enabled: true });
    ex.recordIteration(1500);
    ex.recordIteration(2300);
    const out = ex.format();
    expect(out).toContain('Timing');
    expect(out).toContain('Iteration 1');
    expect(out).toContain('Total');
  });

  it('format() handles no sections gracefully', () => {
    const ex = new Explainer({ enabled: true });
    const out = ex.format();
    expect(out).toContain('Koda Explanation Report');
  });
});
