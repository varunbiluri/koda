import { describe, it, expect } from 'vitest';
import { tokenize } from '../../../src/engine/embeddings/tokenizer.js';

describe('tokenizer', () => {
  it('splits camelCase', () => {
    const tokens = tokenize('getUserName');
    expect(tokens).toContain('get');
    expect(tokens).toContain('user');
    expect(tokens).toContain('name');
  });

  it('splits snake_case', () => {
    const tokens = tokenize('get_user_name');
    expect(tokens).toContain('get');
    expect(tokens).toContain('user');
    expect(tokens).toContain('name');
  });

  it('removes stop words', () => {
    const tokens = tokenize('const getUserName = function() { return this.name; }');
    expect(tokens).not.toContain('const');
    expect(tokens).not.toContain('function');
    expect(tokens).not.toContain('return');
    expect(tokens).not.toContain('this');
  });

  it('removes single character tokens', () => {
    const tokens = tokenize('a b c x y z');
    expect(tokens).toHaveLength(0);
  });

  it('lowercases everything', () => {
    const tokens = tokenize('UserService ProcessData');
    for (const t of tokens) {
      expect(t).toBe(t.toLowerCase());
    }
  });
});
