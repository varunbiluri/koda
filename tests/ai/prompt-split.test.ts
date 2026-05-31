import { describe, it, expect } from 'vitest';
import { STATIC_SYSTEM_CORE, buildSplitSystemPrompt } from '../../src/ai/context/prompt-split.js';

describe('prompt-split', () => {
  it('static core mentions reference-first policy', () => {
    expect(STATIC_SYSTEM_CORE).toContain('get_tool_result');
    expect(STATIC_SYSTEM_CORE).toContain('startLine/endLine');
  });

  it('buildSplitSystemPrompt includes repo metadata', () => {
    const prompt = buildSplitSystemPrompt({
      ctx: { repoName: 'demo', branch: 'main', rootPath: '/tmp/demo', fileCount: 10 },
      retrievalBlock: '## bootstrap',
    });
    expect(prompt).toContain(STATIC_SYSTEM_CORE);
    expect(prompt).toContain('demo');
    expect(prompt).toContain('bootstrap');
  });
});
