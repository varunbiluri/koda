import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { discoverFiles, detectLanguage } from '../../../src/engine/file-discovery.js';

const FIXTURES = path.resolve(__dirname, '../../fixtures/sample-project');

describe('detectLanguage', () => {
  it('detects TypeScript files', () => {
    expect(detectLanguage('foo.ts')).toBe('typescript');
    expect(detectLanguage('bar.tsx')).toBe('typescript');
  });

  it('detects Python files', () => {
    expect(detectLanguage('foo.py')).toBe('python');
  });

  it('returns null for binary files', () => {
    expect(detectLanguage('image.png')).toBeNull();
    expect(detectLanguage('font.woff2')).toBeNull();
  });

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('file.xyz')).toBeNull();
  });
});

describe('discoverFiles', () => {
  it('discovers files in a directory', async () => {
    const result = await discoverFiles(FIXTURES);
    expect(result.files.length).toBeGreaterThan(0);

    const paths = result.files.map(f => f.path);
    expect(paths).toContain(path.join('src', 'index.ts'));
    expect(paths).toContain(path.join('src', 'utils.ts'));
  });

  it('detects language for each file', async () => {
    const result = await discoverFiles(FIXTURES);
    for (const file of result.files) {
      expect(file.language).toBeTruthy();
    }
  });

  it('computes hash for each file', async () => {
    const result = await discoverFiles(FIXTURES);
    for (const file of result.files) {
      expect(file.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
