/**
 * koda update — unit tests for version comparison and changelog helpers.
 * Does NOT invoke npm or touch the network.
 */

import { describe, it, expect } from 'vitest';

// ── Inline the pure helpers so we can test them without importing the command ─

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

const CHANGELOG: Record<string, string[]> = {
  '0.2.1': ['Performance improvements', 'Smarter retries'],
  '0.2.0': ['koda add', 'Parallel DAG scheduler'],
  '0.1.2': ['Onboarding wizard'],
};

function changesBetween(from: string, to: string): string[] {
  const versions = Object.keys(CHANGELOG).filter(
    (v) => semverGt(v, from) && !semverGt(v, to),
  );
  versions.sort((a, b) => (semverGt(a, b) ? -1 : 1));
  return versions.flatMap((v) => CHANGELOG[v] ?? []);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('semverGt', () => {
  it('0.2.1 > 0.2.0', () => expect(semverGt('0.2.1', '0.2.0')).toBe(true));
  it('0.2.0 > 0.1.9', () => expect(semverGt('0.2.0', '0.1.9')).toBe(true));
  it('1.0.0 > 0.9.9', () => expect(semverGt('1.0.0', '0.9.9')).toBe(true));
  it('0.2.0 not > 0.2.0', () => expect(semverGt('0.2.0', '0.2.0')).toBe(false));
  it('0.1.9 not > 0.2.0', () => expect(semverGt('0.1.9', '0.2.0')).toBe(false));
  it('handles v-prefix', () => expect(semverGt('v0.2.1', 'v0.2.0')).toBe(true));
});

describe('changesBetween', () => {
  it('returns all entries between two versions (exclusive lower, inclusive upper)', () => {
    const changes = changesBetween('0.1.1', '0.2.1');
    expect(changes).toContain('Performance improvements');
    expect(changes).toContain('koda add');
    expect(changes).toContain('Onboarding wizard');
  });

  it('excludes entries already in current version', () => {
    const changes = changesBetween('0.2.0', '0.2.1');
    expect(changes).toContain('Performance improvements');
    expect(changes).not.toContain('koda add');
  });

  it('returns empty when already on latest', () => {
    const changes = changesBetween('0.2.1', '0.2.1');
    expect(changes).toHaveLength(0);
  });

  it('returns empty when current is ahead of target', () => {
    const changes = changesBetween('0.3.0', '0.2.1');
    expect(changes).toHaveLength(0);
  });

  it('newest changes come first', () => {
    const changes = changesBetween('0.1.1', '0.2.1');
    const idx021 = changes.indexOf('Performance improvements');
    const idx020 = changes.indexOf('koda add');
    expect(idx021).toBeLessThan(idx020);
  });
});
