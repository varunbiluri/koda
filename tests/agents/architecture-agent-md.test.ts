import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArchitectureAgentMd } from '../../src/agents/architecture-agent.js';
import type { RepoIndex } from '../../src/types/index.js';

// Mock fs.writeFile so tests don't touch disk
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
}));

function makeIndex(overrides: Partial<RepoIndex> = {}): RepoIndex {
  return {
    chunks: [],
    files: [],
    edges: [],
    nodes: [],
    vectors: [],
    vocabulary: { terms: [], termToIndex: {} },
    metadata: {
      version: '1',
      createdAt: '',
      rootPath: '/project',
      fileCount: 10,
      chunkCount: 0,
      edgeCount: 0,
    },
    ...overrides,
  } as unknown as RepoIndex;
}

describe('ArchitectureAgentMd', () => {
  let agent: ArchitectureAgentMd;

  beforeEach(() => {
    agent = new ArchitectureAgentMd();
    vi.clearAllMocks();
  });

  // ── Language detection ─────────────────────────────────────────────────────

  it('detects TypeScript files', () => {
    const index = makeIndex({
      files: [{ path: 'src/index.ts' }, { path: 'src/util.ts' }] as RepoIndex['files'],
    });
    const report = agent.analyze(index);
    expect(report.languages).toContain('TypeScript');
  });

  it('detects Python files', () => {
    const index = makeIndex({
      files: [{ path: 'main.py' }, { path: 'utils.py' }] as RepoIndex['files'],
    });
    const report = agent.analyze(index);
    expect(report.languages).toContain('Python');
  });

  it('detects multiple languages', () => {
    const index = makeIndex({
      files: [
        { path: 'src/app.ts' },
        { path: 'scripts/deploy.py' },
        { path: 'service/main.go' },
      ] as RepoIndex['files'],
    });
    const report = agent.analyze(index);
    expect(report.languages).toContain('TypeScript');
    expect(report.languages).toContain('Python');
    expect(report.languages).toContain('Go');
  });

  it('returns empty languages for unknown extensions', () => {
    const index = makeIndex({
      files: [{ path: 'README.md' }, { path: 'config.yaml' }] as RepoIndex['files'],
    });
    const report = agent.analyze(index);
    expect(report.languages).toHaveLength(0);
  });

  // ── Framework detection ────────────────────────────────────────────────────

  it('detects Next.js from config file', () => {
    const index = makeIndex({
      files: [{ path: 'next.config.js' }] as RepoIndex['files'],
    });
    const report = agent.analyze(index);
    expect(report.frameworks).toContain('Next.js');
  });

  it('detects Express from chunk content', () => {
    const index = makeIndex({
      chunks: [
        {
          id: 'c1',
          filePath: 'src/server.ts',
          name: 'app',
          type: 'misc',
          content: "import express from 'express';\nconst app = express();",
          startLine: 1,
          endLine: 2,
          language: 'typescript',
        },
      ],
    });
    const report = agent.analyze(index);
    expect(report.frameworks).toContain('Express');
  });

  it('returns empty frameworks when none match', () => {
    const index = makeIndex({
      files: [{ path: 'src/plain.ts' }] as RepoIndex['files'],
      chunks: [
        {
          id: 'c1',
          filePath: 'src/plain.ts',
          name: 'fn',
          type: 'function',
          content: 'export function hello() { return "world"; }',
          startLine: 1,
          endLine: 1,
          language: 'typescript',
        },
      ],
    });
    const report = agent.analyze(index);
    expect(report.frameworks).toHaveLength(0);
  });

  // ── Entrypoint detection ───────────────────────────────────────────────────

  it('detects src/index.ts as entrypoint', () => {
    const index = makeIndex({
      files: [
        { path: 'src/index.ts' },
        { path: 'src/utils.ts' },
      ] as RepoIndex['files'],
    });
    const report = agent.analyze(index);
    expect(report.entrypoints).toContain('src/index.ts');
    expect(report.entrypoints).not.toContain('src/utils.ts');
  });

  it('detects main.py as entrypoint', () => {
    const index = makeIndex({
      files: [{ path: 'main.py' }] as RepoIndex['files'],
    });
    const report = agent.analyze(index);
    expect(report.entrypoints).toContain('main.py');
  });

  // ── Key module detection ───────────────────────────────────────────────────

  it('detects key modules from src subdirectories', () => {
    const index = makeIndex({
      files: [
        { path: 'src/auth/login.ts' },
        { path: 'src/auth/logout.ts' },
        { path: 'src/api/routes.ts' },
      ] as RepoIndex['files'],
    });
    const report = agent.analyze(index);
    expect(report.keyModules).toContain('src/auth');
    expect(report.keyModules).toContain('src/api');
  });

  // ── Prompt file detection ──────────────────────────────────────────────────

  it('detects files containing "openai" keyword', () => {
    const index = makeIndex({
      chunks: [
        {
          id: 'c1',
          filePath: 'src/ai/provider.ts',
          name: 'init',
          type: 'misc',
          content: "import OpenAI from 'openai';",
          startLine: 1,
          endLine: 1,
          language: 'typescript',
        },
      ],
    });
    const report = agent.analyze(index);
    expect(report.promptFiles).toContain('src/ai/provider.ts');
  });

  it('detects files containing "system prompt" keyword', () => {
    const index = makeIndex({
      chunks: [
        {
          id: 'c1',
          filePath: 'src/ai/prompts.ts',
          name: 'getSystemPrompt',
          type: 'function',
          content: 'export function getSystemPrompt() { return "You are Koda"; }',
          startLine: 1,
          endLine: 1,
          language: 'typescript',
        },
      ],
    });
    const report = agent.analyze(index);
    expect(report.promptFiles).toContain('src/ai/prompts.ts');
  });

  it('does not flag plain business logic as prompt files', () => {
    const index = makeIndex({
      chunks: [
        {
          id: 'c1',
          filePath: 'src/auth/login.ts',
          name: 'loginUser',
          type: 'function',
          content: 'export async function loginUser(email: string) { return db.find(email); }',
          startLine: 1,
          endLine: 1,
          language: 'typescript',
        },
      ],
    });
    const report = agent.analyze(index);
    expect(report.promptFiles).not.toContain('src/auth/login.ts');
  });

  // ── AGENTS.md generation ───────────────────────────────────────────────────

  it('generates AGENTS.md with project name from rootPath', () => {
    const index = makeIndex();
    const report = agent.analyze(index);
    expect(report.agentsMd).toContain('# AGENTS.md — project');
  });

  it('generated AGENTS.md includes detected language', () => {
    const index = makeIndex({
      files: [{ path: 'src/index.ts' }] as RepoIndex['files'],
    });
    const report = agent.analyze(index);
    expect(report.agentsMd).toContain('TypeScript');
  });

  it('generated AGENTS.md contains Rules for AI Agents section', () => {
    const index = makeIndex();
    const report = agent.analyze(index);
    expect(report.agentsMd).toContain('## Rules for AI Agents');
  });

  it('generated AGENTS.md contains entrypoints section when present', () => {
    const index = makeIndex({
      files: [{ path: 'src/index.ts' }] as RepoIndex['files'],
    });
    const report = agent.analyze(index);
    expect(report.agentsMd).toContain('### Entrypoints');
    expect(report.agentsMd).toContain('`src/index.ts`');
  });

  it('generated AGENTS.md contains prompt files section when detected', () => {
    const index = makeIndex({
      chunks: [
        {
          id: 'c1',
          filePath: 'src/prompts.ts',
          name: 'p',
          type: 'misc',
          content: 'const systemPrompt = "you are koda"',
          startLine: 1,
          endLine: 1,
          language: 'typescript',
        },
      ],
    });
    const report = agent.analyze(index);
    expect(report.agentsMd).toContain('## Prompts');
    expect(report.agentsMd).toContain('`src/prompts.ts`');
  });

  // ── File writing ───────────────────────────────────────────────────────────

  it('writeAgentsMd writes to <rootPath>/AGENTS.md', async () => {
    const { writeFile } = await import('node:fs/promises');
    await agent.writeAgentsMd('/my/repo', '# content');
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('AGENTS.md'),
      '# content',
      'utf-8',
    );
    const callPath = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callPath).toMatch(/\/my\/repo\/AGENTS\.md$/);
  });
});
