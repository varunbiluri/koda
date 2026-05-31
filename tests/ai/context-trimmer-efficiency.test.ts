import { describe, it, expect } from 'vitest';
import { estimateChars, capToolMessages } from '../../src/ai/context/context-trimmer.js';

describe('estimateChars — tool_calls', () => {
  it('counts tool_calls JSON in assistant messages', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: '1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
      },
    ];
    const withCalls = estimateChars(msgs);
    const without   = estimateChars([{ role: 'user', content: 'hi' }]);
    expect(withCalls).toBeGreaterThan(without);
  });
});

describe('capToolMessages', () => {
  it('truncates oversized tool messages preserving ref id', () => {
    const long = `[result_1] read_file → 100 lines (9000 chars)\nPreview: ${'a'.repeat(900)}`;
    const out  = capToolMessages([{ role: 'tool', content: long }]);
    expect(out[0]!.content!.length).toBeLessThanOrEqual(820);
    expect(out[0]!.content).toContain('[result_1]');
  });
});
