import { describe, it, expect } from 'vitest';
import { buildToolResultInjection, shouldUseReference } from '../../src/runtime/tool-result-injection.js';

describe('buildToolResultInjection', () => {
  it('keeps errors inline', () => {
    const r = buildToolResultInjection('read_file', 'Error: not found', 'result_1');
    expect(r.viaRef).toBe(false);
    expect(r.content).toContain('Error: not found');
  });

  it('uses reference for read_file at 200+ chars', () => {
    const body = 'x'.repeat(200);
    const r    = buildToolResultInjection('read_file', body, 'result_2');
    expect(r.viaRef).toBe(true);
  });

  it('uses reference on cache hit even for small output', () => {
    const r = buildToolResultInjection('read_file', 'small', 'result_3', { cacheHit: true });
    expect(r.viaRef).toBe(true);
    expect(r.content).toContain('[cached]');
  });
});

describe('shouldUseReference', () => {
  it('reference-first tools at 200+ chars', () => {
    expect(shouldUseReference('grep_code', 199)).toBe(false);
    expect(shouldUseReference('grep_code', 200)).toBe(true);
  });

  it('other tools at 5000+ chars', () => {
    expect(shouldUseReference('write_file', 4999)).toBe(false);
    expect(shouldUseReference('write_file', 5000)).toBe(true);
  });
});
