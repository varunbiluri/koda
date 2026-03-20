/**
 * ProactiveAdvisor — unit tests
 */

import { describe, it, expect } from 'vitest';
import { ProactiveAdvisor } from '../../src/intelligence/proactive-advisor.js';
import { RepoGraph } from '../../src/intelligence/repo-graph.js';

async function makeAdvisor(rootPath = '/repo') {
  const graph = await RepoGraph.build(rootPath, []);
  return new ProactiveAdvisor(rootPath, graph);
}

describe('ProactiveAdvisor', () => {
  it('suggest returns empty array when no files changed', async () => {
    const advisor = await makeAdvisor();
    expect(await advisor.suggest([])).toHaveLength(0);
  });

  it('suggest does not throw for non-source files', async () => {
    const advisor = await makeAdvisor();
    // Non-source files like .json, .md, etc. should be skipped silently
    const suggestions = await advisor.suggest(['package.json', 'README.md']);
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('formatForStream produces INFO/WARN prefixed strings', async () => {
    const advisor = await makeAdvisor();
    const suggestions = [
      { action: 'run tests', message: 'many dependents', level: 'warn' as const },
      { action: 'check usage', message: 'no importers',   level: 'info' as const },
      { action: 'update barrel', message: 'missing export', level: 'tip' as const },
    ];
    const lines = advisor.formatForStream(suggestions);
    expect(lines[0]).toMatch(/^WARN SUGGEST:/);
    expect(lines[1]).toMatch(/^INFO SUGGEST:/);
    expect(lines[2]).toMatch(/^INFO SUGGEST:/); // tip → INFO
  });

  it('deduplicates suggestions by action label', async () => {
    const advisor = await makeAdvisor();
    // Suggest the same file twice — should deduplicate
    const suggestions = await advisor.suggest([
      'src/auth.ts',
      'src/auth.ts',
    ]);
    const actions = suggestions.map((s) => s.action);
    const unique   = new Set(actions);
    expect(actions.length).toBe(unique.size);
  });
});
