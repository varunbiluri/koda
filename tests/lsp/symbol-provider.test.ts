import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolIndex } from '../../src/symbols/symbol-index.js';
import { SymbolProvider } from '../../src/lsp/symbol-provider.js';
import type { SymbolRecord } from '../../src/symbols/types.js';

function makeSymbol(overrides: Partial<SymbolRecord> & { name: string; id: string }): SymbolRecord {
  return {
    id: overrides.id,
    name: overrides.name,
    qualifiedName: overrides.qualifiedName ?? overrides.name,
    type: overrides.type ?? 'function',
    location: overrides.location ?? {
      filePath: 'src/foo.ts',
      line: 10,
      column: 0,
      endLine: 20,
      endColumn: 0,
    },
    signature: overrides.signature,
    docstring: overrides.docstring,
    modifiers: overrides.modifiers ?? [],
    parent: overrides.parent,
    references: overrides.references ?? [],
    callers: overrides.callers ?? new Set<string>(),
    metadata: overrides.metadata ?? { exported: true, imported: false },
  };
}

describe('SymbolProvider', () => {
  let index: SymbolIndex;
  let provider: SymbolProvider;

  beforeEach(() => {
    index = new SymbolIndex();

    const login = makeSymbol({
      id: 'src/auth.ts#loginUser',
      name: 'loginUser',
      qualifiedName: 'loginUser',
      type: 'function',
      location: { filePath: 'src/auth.ts', line: 5, column: 0, endLine: 15, endColumn: 0 },
      signature: 'async function loginUser(username: string, password: string): Promise<User>',
      callers: new Set(['src/api.ts#handleLogin']),
    });

    const handleLogin = makeSymbol({
      id: 'src/api.ts#handleLogin',
      name: 'handleLogin',
      qualifiedName: 'handleLogin',
      type: 'function',
      location: { filePath: 'src/api.ts', line: 25, column: 0, endLine: 35, endColumn: 0 },
    });

    index.add(login);
    index.add(handleLogin);

    provider = new SymbolProvider(index);
  });

  it('findDefinition returns correct location', () => {
    const loc = provider.findDefinition('loginUser');
    expect(loc).not.toBeNull();
    expect(loc!.uri).toBe('file://src/auth.ts');
    expect(loc!.range.start.line).toBe(4); // 0-indexed
  });

  it('findDefinition returns null for unknown symbol', () => {
    const loc = provider.findDefinition('unknownFunction');
    expect(loc).toBeNull();
  });

  it('findReferences returns definition and callers', () => {
    const refs = provider.findReferences('loginUser');
    expect(refs.definition).not.toBeNull();
    expect(refs.callers).toHaveLength(1);
    expect(refs.files).toContain('src/auth.ts');
  });

  it('workspaceSymbols returns fuzzy matches', () => {
    const results = provider.workspaceSymbols('login');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.symbol.name === 'loginUser')).toBe(true);
  });

  it('workspaceSymbols returns empty for no match', () => {
    const results = provider.workspaceSymbols('xyznonexistent');
    expect(results).toHaveLength(0);
  });

  it('getHoverInfo returns full hover object', () => {
    const info = provider.getHoverInfo('loginUser');
    expect(info).not.toBeNull();
    expect(info!.symbol.name).toBe('loginUser');
    expect(info!.definedIn).toBe('src/auth.ts');
    expect(info!.callers).toHaveLength(1);
  });

  it('getHoverInfo returns null for unknown symbol', () => {
    const info = provider.getHoverInfo('notExists');
    expect(info).toBeNull();
  });
});
