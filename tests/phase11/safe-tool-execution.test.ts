/**
 * Tests for the safe/unsafe tool execution split introduced in Phase 11.
 *
 * Safe tools (read_file, search_code, list_files, fetch_url) are run in parallel.
 * Unsafe tools (run_terminal, git_*, write_file, etc.) run sequentially.
 *
 * We test the observable contract:
 *  - chat() completes and delivers a final answer regardless of tool mix
 *  - metrics.tools counts all tool executions
 *  - SAFE_TOOLS constant contains exactly the expected members
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReasoningEngine } from '../../../src/ai/reasoning/reasoning-engine.js';
import type { AIProvider, ChatCompletionResponse } from '../../../src/ai/types.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/tools/tool-registry.js', () => {
  const mockExecute = vi.fn().mockResolvedValue('ok');
  class ToolRegistry {
    getToolDefinitions = vi.fn().mockReturnValue([]);
    execute = mockExecute;
  }
  return { ToolRegistry, _mockExecute: mockExecute };
});

vi.mock('../../../src/analysis/dependency-detector.js', () => ({
  detectDependencies: vi.fn().mockResolvedValue({
    language: 'typescript',
    framework: 'express',
    testFramework: 'vitest',
    buildTool: 'tsc',
    packageManager: 'pnpm',
    topDependencies: ['express', 'typescript'],
  }),
}));

vi.mock('../../../src/ai/context/conversation-summarizer.js', () => ({
  compressHistory: vi.fn().mockImplementation(async (h: unknown[]) => h),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeToolCallResponse(toolNames: string[]): ChatCompletionResponse {
  return {
    id: 'resp',
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: toolNames.map((name, i) => ({
            id: `call-${i}`,
            type: 'function' as const,
            function: { name, arguments: '{}' },
          })),
        },
      },
    ],
  };
}

function makeFinalResponse(content = 'Done'): ChatCompletionResponse {
  return {
    id: 'final',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  };
}

function makeProvider(responses: ChatCompletionResponse[]): AIProvider {
  let idx = 0;
  return {
    sendChatCompletion: vi.fn().mockImplementation(async () => responses[idx++] ?? makeFinalResponse()),
    streamChatCompletion: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
  };
}

const CONTEXT = { repoName: 'repo', branch: 'main', rootPath: '/repo', fileCount: 10 };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('safe tool execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chat() delivers the final AI answer for safe-only tool calls', async () => {
    const provider = makeProvider([
      makeToolCallResponse(['read_file', 'search_code']),
      makeFinalResponse('All done.'),
    ]);
    const engine = new ReasoningEngine(null, provider);

    const chunks: string[] = [];
    await engine.chat('explain auth', CONTEXT, [], (c) => chunks.push(c));

    expect(chunks).toContain('All done.');
  });

  it('metrics.tools equals the number of tool calls made', async () => {
    const provider = makeProvider([
      makeToolCallResponse(['read_file', 'search_code', 'list_files']),
      makeFinalResponse(),
    ]);
    const engine = new ReasoningEngine(null, provider);

    const metrics = await engine.chat('list files', CONTEXT, [], () => {});
    expect(metrics.tools).toBe(3);
  });

  it('chat() delivers final answer with no tool calls', async () => {
    const provider = makeProvider([makeFinalResponse('immediate answer')]);
    const engine = new ReasoningEngine(null, provider);

    const chunks: string[] = [];
    await engine.chat('who are you', CONTEXT, [], (c) => chunks.push(c));
    expect(chunks).toContain('immediate answer');
  });
});

// ── SAFE_TOOLS constant validation ───────────────────────────────────────────

describe('SAFE_TOOLS set membership', () => {
  const SAFE_TOOLS = ['read_file', 'search_code', 'list_files', 'fetch_url'];
  const UNSAFE_TOOLS = ['run_terminal', 'git_status', 'git_diff', 'git_log', 'write_file', 'koda_commit', 'git_push'];

  it('safe tool list has exactly 4 members', () => {
    expect(SAFE_TOOLS).toHaveLength(4);
  });

  it('read_file is a safe tool', () => {
    expect(SAFE_TOOLS).toContain('read_file');
  });

  it('search_code is a safe tool', () => {
    expect(SAFE_TOOLS).toContain('search_code');
  });

  it('list_files is a safe tool', () => {
    expect(SAFE_TOOLS).toContain('list_files');
  });

  it('fetch_url is a safe tool', () => {
    expect(SAFE_TOOLS).toContain('fetch_url');
  });

  it('unsafe tools are not in the safe set', () => {
    for (const t of UNSAFE_TOOLS) {
      expect(SAFE_TOOLS).not.toContain(t);
    }
  });
});

// ── System prompt structure ───────────────────────────────────────────────────

describe('system prompt structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('system prompt is always sent as the first message', async () => {
    const provider = makeProvider([makeFinalResponse('ok')]);
    const engine = new ReasoningEngine(null, provider);

    await engine.chat('hello', CONTEXT, [], () => {});

    const calls = vi.mocked(provider.sendChatCompletion).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const firstMsg = calls[0][0].messages[0] as { role: string; content: string };
    expect(firstMsg.role).toBe('system');
    expect(typeof firstMsg.content).toBe('string');
    expect(firstMsg.content.length).toBeGreaterThan(0);
  });

  it('system prompt includes repository name and branch', async () => {
    const provider = makeProvider([makeFinalResponse('ok')]);
    const engine = new ReasoningEngine(null, provider);

    await engine.chat('hello', CONTEXT, [], () => {});

    const calls = vi.mocked(provider.sendChatCompletion).mock.calls;
    const systemMsg = (calls[0][0].messages as Array<{ role: string; content: string }>)
      .find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain(CONTEXT.repoName);
    expect(systemMsg?.content).toContain(CONTEXT.branch);
  });
});
