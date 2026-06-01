import { describe, it, expect } from 'vitest';
import { parseToolStage, diffStats } from '../../src/serve/stage-parser.js';

describe('parseToolStage', () => {
  it('parses READ prefix', () => {
    const r = parseToolStage('READ src/auth.ts');
    expect(r.kind).toBe('READ');
    expect(r.isTool).toBe(true);
    expect(r.detail).toBe('src/auth.ts');
  });

  it('parses ROUTER info', () => {
    const r = parseToolStage('INFO ROUTER: SIMPLE task');
    expect(r.kind).toBe('ROUTER');
    expect(r.isTool).toBe(true);
  });

  it('sends generic INFO to terminal channel', () => {
    const r = parseToolStage('INFO thinking');
    expect(r.kind).toBe('INFO');
    expect(r.isTool).toBe(false);
  });
});

describe('diffStats', () => {
  it('counts added and removed lines', () => {
    const stats = diffStats('a\nb', 'a\nc');
    expect(stats.added).toBeGreaterThan(0);
    expect(stats.removed).toBeGreaterThan(0);
  });
});
