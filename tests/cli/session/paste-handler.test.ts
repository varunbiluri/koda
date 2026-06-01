import { describe, it, expect } from 'vitest';
import { collapsePaste } from '../../../src/cli/session/paste-handler.js';

describe('collapsePaste', () => {
  it('joins multiline web text into one line', () => {
    const raw = 'Skip to content\ncodeaashu\nclaude-code\nRepository navigation';
    expect(collapsePaste(raw)).toBe('Skip to content codeaashu claude-code Repository navigation');
  });

  it('collapses repeated whitespace and tabs', () => {
    expect(collapsePaste('hello\t\tworld\n\nfoo')).toBe('hello world foo');
  });

  it('trims leading and trailing space', () => {
    expect(collapsePaste('  one line  ')).toBe('one line');
  });

  it('handles empty paste', () => {
    expect(collapsePaste('\n\n\t')).toBe('');
  });
});
