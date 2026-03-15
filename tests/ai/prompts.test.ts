import { describe, it, expect } from 'vitest';
import { getSystemPrompt } from '../../src/ai/prompts/system-prompt.js';
import { buildCodeAnalysisPrompt } from '../../src/ai/prompts/code-analysis.js';
import type { IndexMetadata } from '../../src/types/index.js';

describe('system prompt', () => {
  it('returns a non-empty system prompt', () => {
    const prompt = getSystemPrompt();
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain('Koda');
    expect(prompt).toContain('AI software engineer');
  });
});

describe('code analysis prompt', () => {
  it('builds a complete analysis prompt', () => {
    const metadata: IndexMetadata = {
      version: '0.1.1',
      createdAt: '2024-01-01',
      rootPath: '/test/repo',
      fileCount: 10,
      chunkCount: 50,
      edgeCount: 5,
    };

    const prompt = buildCodeAnalysisPrompt({
      query: 'How does authentication work?',
      context: '## File: auth.ts\n```typescript\nfunction login() {}\n```',
      metadata,
      fileReferences: '1. auth.ts\n2. middleware.ts',
    });

    expect(prompt).toContain('How does authentication work?');
    expect(prompt).toContain('/test/repo');
    expect(prompt).toContain('Total Files: 10');
    expect(prompt).toContain('## File: auth.ts');
    expect(prompt).toContain('1. auth.ts');
    expect(prompt).toContain('2. middleware.ts');
  });

  it('includes repository metadata', () => {
    const metadata: IndexMetadata = {
      version: '0.1.1',
      createdAt: '2024-01-01',
      rootPath: '/my/project',
      fileCount: 100,
      chunkCount: 500,
      edgeCount: 50,
    };

    const prompt = buildCodeAnalysisPrompt({
      query: 'test query',
      context: 'test context',
      metadata,
      fileReferences: '',
    });

    expect(prompt).toContain('Total Files: 100');
    expect(prompt).toContain('Total Code Chunks: 500');
    expect(prompt).toContain('Dependencies: 50');
  });
});
