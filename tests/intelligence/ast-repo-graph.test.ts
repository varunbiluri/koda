/**
 * ASTRepoGraph — unit tests
 *
 * We only test the public API (impact analysis, symbol API) since
 * tree-sitter parsing requires real files. The graph-building tests
 * use an empty file list to verify the zero-state contract.
 */

import { describe, it, expect } from 'vitest';
import { ASTRepoGraph } from '../../src/intelligence/ast-repo-graph.js';

describe('ASTRepoGraph.build (empty)', () => {
  it('builds with no files without throwing', async () => {
    const g = await ASTRepoGraph.build('/repo', []);
    expect(g.nodeCount).toBe(0);
  });

  it('getSymbols returns empty array for unknown file', async () => {
    const g = await ASTRepoGraph.build('/repo', []);
    expect(g.getSymbols('src/unknown.ts')).toHaveLength(0);
  });

  it('getDefinitionFiles returns empty array for unknown symbol', async () => {
    const g = await ASTRepoGraph.build('/repo', []);
    expect(g.getDefinitionFiles('AuthService')).toHaveLength(0);
  });

  it('getAllSymbols returns empty array when empty', async () => {
    const g = await ASTRepoGraph.build('/repo', []);
    expect(g.getAllSymbols()).toHaveLength(0);
  });

  it('formatSymbolSummary returns empty string for unknown file', async () => {
    const g = await ASTRepoGraph.build('/repo', []);
    expect(g.formatSymbolSummary('src/auth.ts')).toBe('');
  });

  it('buildSymbolContext returns empty string when no symbols', async () => {
    const g = await ASTRepoGraph.build('/repo', []);
    expect(g.buildSymbolContext(['src/auth.ts'])).toBe('');
  });

  it('impact analysis works same as parent RepoGraph', async () => {
    const g = await ASTRepoGraph.build('/repo', []);
    const report = g.impactReport(['src/foo.ts']);
    expect(report.level).toBe('LOW');
    expect(report.affectedCount).toBe(0);
  });
});

describe('ASTRepoGraph inheritance', () => {
  it('is an instance that exposes getDirectDependents', async () => {
    const g = await ASTRepoGraph.build('/repo', []);
    // Inherited from RepoGraph
    expect(typeof g.getDirectDependents).toBe('function');
    expect(typeof g.getImpactSet).toBe('function');
    expect(typeof g.impactReport).toBe('function');
    expect(typeof g.formatImpactWarning).toBe('function');
  });
});
