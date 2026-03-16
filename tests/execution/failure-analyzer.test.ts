/**
 * Tests for FailureAnalyzer.
 */
import { describe, it, expect } from 'vitest';
import { FailureAnalyzer, failureAnalyzer } from '../../src/execution/failure-analyzer.js';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('FailureAnalyzer.classify()', () => {
  it('detects compile_error from "error TS"', () => {
    const result = failureAnalyzer.classify('src/auth.ts(10,5): error TS2322: Type string is not assignable to number');
    expect(result.type).toBe('compile_error');
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.fixPrompt).toContain('tsc');
  });

  it('detects compile_error from "TypeScript.*error"', () => {
    const result = failureAnalyzer.classify('TypeScript compilation error: Cannot find type');
    expect(result.type).toBe('compile_error');
  });

  it('detects missing_dep from "Cannot find module"', () => {
    const result = failureAnalyzer.classify("Error: Cannot find module './auth-service'");
    expect(result.type).toBe('missing_dep');
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.fixPrompt).toContain('import');
  });

  it('detects missing_dep from "Module not found"', () => {
    const result = failureAnalyzer.classify('Module not found: @types/express');
    expect(result.type).toBe('missing_dep');
  });

  it('detects test_failure from assertion error', () => {
    const result = failureAnalyzer.classify('AssertionError: expected 1 to equal 2\n  at tests/auth.test.ts:25');
    expect(result.type).toBe('test_failure');
    expect(result.fixPrompt).toContain('test');
  });

  it('detects test_failure from "FAIL tests/"', () => {
    const result = failureAnalyzer.classify('FAIL tests/auth.test.ts\n  ● auth › login › should return token');
    expect(result.type).toBe('test_failure');
  });

  it('detects runtime_error from TypeError', () => {
    const result = failureAnalyzer.classify('TypeError: Cannot read properties of undefined (reading "id")');
    expect(result.type).toBe('runtime_error');
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.fixPrompt).toContain('stack trace');
  });

  it('detects runtime_error from "is not a function"', () => {
    const result = failureAnalyzer.classify('TypeError: this.handler is not a function');
    expect(result.type).toBe('runtime_error');
  });

  it('detects logic_bug from generic "failed" text', () => {
    const result = failureAnalyzer.classify('Step failed with exit code 1: something went wrong');
    expect(result.type).toBe('logic_bug');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('returns unknown for unrecognized error text', () => {
    const result = failureAnalyzer.classify('');
    expect(result.type).toBe('unknown');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('fixPrompt always contains the error snippet', () => {
    const errorText = 'error TS2345: Argument of type string is not assignable';
    const result = failureAnalyzer.classify(errorText);
    expect(result.fixPrompt).toContain('error TS2345');
  });

  it('classify is deterministic for the same input', () => {
    const a = failureAnalyzer.classify('error TS2322: Type mismatch');
    const b = failureAnalyzer.classify('error TS2322: Type mismatch');
    expect(a.type).toBe(b.type);
    expect(a.confidence).toBe(b.confidence);
  });
});

describe('FailureAnalyzer.extractSnippet()', () => {
  it('strips ANSI codes', () => {
    const text = '\x1b[31merror\x1b[0m: something';
    const result = FailureAnalyzer.extractSnippet(text);
    expect(result).not.toContain('\x1b[');
    expect(result).toContain('error');
  });

  it('limits output to maxChars', () => {
    const text = 'x'.repeat(1000);
    const result = FailureAnalyzer.extractSnippet(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('returns empty string for empty input', () => {
    expect(FailureAnalyzer.extractSnippet('')).toBe('');
  });
});

describe('FailureAnalyzer singleton', () => {
  it('exported failureAnalyzer is an instance of FailureAnalyzer', () => {
    expect(failureAnalyzer).toBeInstanceOf(FailureAnalyzer);
  });
});
