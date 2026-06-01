import { describe, it, expect } from 'vitest';
import { normalizePauseChoice } from '../../../src/cli/session/pause-menu.js';

describe('normalizePauseChoice', () => {
  it('maps cancel aliases', () => {
    expect(normalizePauseChoice('2')).toBe('cancel');
    expect(normalizePauseChoice('[2]')).toBe('cancel');
    expect(normalizePauseChoice('cancel')).toBe('cancel');
    expect(normalizePauseChoice('exit')).toBe('cancel');
    expect(normalizePauseChoice('quit')).toBe('cancel');
  });

  it('maps modify aliases', () => {
    expect(normalizePauseChoice('3')).toBe('modify');
    expect(normalizePauseChoice('[3]')).toBe('modify');
    expect(normalizePauseChoice('modify')).toBe('modify');
  });

  it('defaults to resume', () => {
    expect(normalizePauseChoice('1')).toBe('resume');
    expect(normalizePauseChoice('[1]')).toBe('resume');
    expect(normalizePauseChoice('resume')).toBe('resume');
  });

  it('does not treat partial prompt text as cancel', () => {
    expect(normalizePauseChoice('why do we need this plan to create pr 2')).toBe('resume');
  });
});
