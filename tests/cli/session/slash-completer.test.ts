import { describe, it, expect } from 'vitest';
import { filterSlashCommands, slashCompleter } from '../../../src/cli/session/slash/completer.js';
import { SLASH_COMMANDS } from '../../../src/cli/session/slash/registry.js';

describe('filterSlashCommands', () => {
  it('returns all commands when only "/" is typed', () => {
    const hits = filterSlashCommands('/');
    expect(hits.length).toBe(SLASH_COMMANDS.length);
    expect(hits.some((h) => h.name === '/help')).toBe(true);
    expect(hits.some((h) => h.name === '/init')).toBe(true);
  });

  it('filters by prefix as user types', () => {
    const hits = filterSlashCommands('/co');
    expect(hits.map((h) => h.name)).toContain('/commit');
    expect(hits.map((h) => h.name)).toContain('/config');
    expect(hits.map((h) => h.name)).toContain('/cost');
    expect(hits.map((h) => h.name)).not.toContain('/help');
  });

  it('matches aliases', () => {
    const hits = filterSlashCommands('/quit');
    expect(hits.some((h) => h.name === '/exit')).toBe(true);
  });

  it('returns empty for non-slash input', () => {
    expect(filterSlashCommands('hello')).toEqual([]);
    expect(filterSlashCommands('')).toEqual([]);
  });

  it('respects limit', () => {
    expect(filterSlashCommands('/', 3)).toHaveLength(3);
  });

  it('includes /init when filtering by /int (fuzzy prefix)', () => {
    const hits = filterSlashCommands('/int');
    expect(hits.map((h) => h.name)).toContain('/init');
  });

  it('matches /init with one-char typo /inti', () => {
    const hits = filterSlashCommands('/inti');
    expect(hits.map((h) => h.name)).toContain('/init');
  });
});

describe('slashCompleter', () => {
  it('returns empty for non-slash lines', () => {
    expect(slashCompleter('fix the bug')).toEqual([[], 'fix the bug']);
  });

  it('returns matching command names for Tab completion', () => {
    const [hits, token] = slashCompleter('/do');
    expect(token).toBe('/do');
    expect(hits).toContain('/doctor');
  });
});
