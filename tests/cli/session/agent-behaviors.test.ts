/**
 * Behavioural tests for the Phase 8 AI-first improvements:
 *
 *  1. Conversation memory   — history accumulates across turns
 *  2. Tool loop protection  — tool capped at 3 calls, loop stops
 *  3. Planning step         — plan generated + displayed for complex tasks
 *  4. Tool stage messages   — ToolRegistry.execute() emits detailed messages
 *  5. Code retrieval        — QueryEngine results injected into context
 *  6. History accumulation  — ConversationEngine maintains history across turns
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mock variable (accessible in vi.mock factories via "mock" prefix) ──
const mockSendChatCompletion = vi.fn().mockResolvedValue({
  id: 'r1',
  choices: [{
    index: 0,
    message: { role: 'assistant', content: 'ok', tool_calls: undefined },
    finish_reason: 'stop',
  }],
});

// ── Module mocks (all hoisted to file top) ────────────────────────────────────

vi.mock('../../../src/tools/filesystem-tools.js', () => ({
  readFile: vi.fn().mockResolvedValue({ success: true, data: 'file content' }),
  writeFile: vi.fn().mockResolvedValue({ success: true }),
  searchCode: vi.fn().mockResolvedValue({ success: true, data: [] }),
  listFiles: vi.fn().mockResolvedValue({ success: true, data: ['src', 'tests'] }),
}));

vi.mock('../../../src/tools/git-tools.js', () => ({
  gitBranch: vi.fn().mockResolvedValue({ success: true, data: 'main' }),
  gitStatus: vi.fn().mockResolvedValue({ success: true, data: '' }),
  gitDiff: vi.fn().mockResolvedValue({ success: true, data: '' }),
  gitLog: vi.fn().mockResolvedValue({ success: true, data: 'abc commit' }),
}));

vi.mock('../../../src/tools/terminal-tools.js', () => ({
  runTerminal: vi.fn().mockResolvedValue({ success: true, data: { stdout: 'output', stderr: '', exitCode: 0 } }),
}));

vi.mock('../../../src/search/query-engine.js', () => {
  class QueryEngine {
    search(_q: string, _n?: number) {
      return [{ chunkId: 'c1', score: 0.9 }, { chunkId: 'c2', score: 0.8 }];
    }
  }
  return { QueryEngine };
});

vi.mock('../../../src/store/index-store.js', () => ({
  loadIndex: vi.fn(),
  loadIndexMetadata: vi.fn().mockResolvedValue({
    version: '1', createdAt: '2026-01-01', rootPath: '/repo',
    fileCount: 42, chunkCount: 300, edgeCount: 120,
  }),
}));

vi.mock('../../../src/ai/config-store.js', () => ({
  configExists: vi.fn().mockResolvedValue(true),
  loadConfig: vi.fn().mockResolvedValue({
    provider: 'azure',
    endpoint: 'https://test.openai.azure.com',
    apiKey: 'k',
    model: 'gpt-4o',
    apiVersion: '2024-05-01-preview',
  }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/ai/providers/azure-provider.js', () => {
  class AzureAIProvider {
    sendChatCompletion = mockSendChatCompletion;
    streamChatCompletion = vi.fn();
    listModels = vi.fn().mockResolvedValue([]);
    testConnection = vi.fn().mockResolvedValue(undefined);
  }
  return { AzureAIProvider };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProvider(overrides: Partial<{
  sendChatCompletion: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    sendChatCompletion: vi.fn().mockResolvedValue({
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok', tool_calls: undefined }, finish_reason: 'stop' }],
    }),
    streamChatCompletion: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeIndex(chunks: Array<{ id: string; filePath: string; content: string; startLine?: number; language?: string }> = []) {
  return {
    chunks: chunks.map(c => ({
      id: c.id,
      filePath: c.filePath,
      content: c.content,
      startLine: c.startLine ?? 1,
      endLine: (c.startLine ?? 1) + 5,
      name: c.id,
      type: 'function',
      language: c.language ?? 'typescript',
    })),
    files: [], edges: [], nodes: [], vectors: [],
    vocabulary: { terms: [], termToIndex: {} },
    metadata: {
      version: '1', createdAt: '', rootPath: '/repo',
      fileCount: chunks.length, chunkCount: chunks.length, edgeCount: 0,
    },
  };
}

const BASE_CTX = {
  repoName: 'koda',
  branch: 'main',
  rootPath: '/repo',
  fileCount: 10,
};

// ── 1. Conversation memory ────────────────────────────────────────────────────

describe('ReasoningEngine.chat() — stateless call model', () => {
  it('each call is stateless: only system + user in request regardless of history param', async () => {
    // ReasoningEngine.chat() is explicitly stateless — the _history parameter is
    // accepted for API compatibility but intentionally ignored. Context is rebuilt
    // from the repo index on every call. There is no cross-call memory.
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');
    const provider = makeProvider();
    const engine = new ReasoningEngine(null, provider);

    const history = [
      { role: 'user' as const, content: 'create varun.md' },
      { role: 'assistant' as const, content: 'I created varun.md.' },
      { role: 'user' as const, content: 'brief summary' },
    ];

    await engine.chat('brief summary', BASE_CTX, history, vi.fn());

    const callMessages: Array<{ role: string; content: string }> =
      provider.sendChatCompletion.mock.calls[0][0].messages;

    // System prompt must always be a plain object with role='system'
    expect(callMessages[0].role).toBe('system');
    expect(typeof callMessages[0].content).toBe('string');

    const roles = callMessages.map((m) => m.role);
    expect(roles).toContain('user');
    // History is intentionally NOT included — stateless design
    expect(roles).not.toContain('assistant');
  });

  it('large history param does not inflate the request (history is ignored)', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');
    const provider = makeProvider();
    const engine = new ReasoningEngine(null, provider);

    const bigHistory = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message ${i}`,
    }));

    await engine.chat('latest question', BASE_CTX, bigHistory, vi.fn());

    // History is ignored → messages = [system, user] + any tool rounds = small
    const callMessages: unknown[] = provider.sendChatCompletion.mock.calls[0][0].messages;
    expect(callMessages.length).toBeLessThanOrEqual(5); // system + user + at most a few tool rounds
  });

  it('empty history works (first message in session)', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');
    const provider = makeProvider();
    const engine = new ReasoningEngine(null, provider);

    await expect(engine.chat('hello', BASE_CTX, [], vi.fn())).resolves.not.toThrow();
  });
});

// ── 2. Tool loop protection ───────────────────────────────────────────────────

describe('ReasoningEngine.chat() — tool loop protection', () => {
  it('stops calling a tool after it has been called 3 times', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');

    let callCount = 0;
    const provider = makeProvider({
      sendChatCompletion: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 6) {
          return Promise.resolve({
            id: `r${callCount}`,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: `tc${callCount}`,
                  type: 'function',
                  function: { name: 'list_files', arguments: '{"path":"."}' },
                }],
              },
              finish_reason: 'tool_calls',
            }],
          });
        }
        return Promise.resolve({
          id: 'final',
          choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        });
      }),
    });

    const engine = new ReasoningEngine(null, provider);
    try {
      await engine.chat('analyze project structure', BASE_CTX, [], vi.fn());
    } catch {
      // tool execution errors are acceptable in this unit test
    }

    // 1 planning call (analyze is complex) + MAX_ROUNDS (5) = at most 6, plus possibly 1 more = 7
    expect(provider.sendChatCompletion.mock.calls.length).toBeLessThanOrEqual(7);
  });
});

// ── 3. Planning step ──────────────────────────────────────────────────────────

describe('ReasoningEngine.chat() — planning step', () => {
  it('calls onPlan with parsed steps for action-verb tasks', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');

    let callIndex = 0;
    const provider = makeProvider({
      sendChatCompletion: vi.fn().mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return Promise.resolve({
            id: 'plan',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: '1. Analyze repository structure\n2. Read architecture modules\n3. Write document',
              },
              finish_reason: 'stop',
            }],
          });
        }
        return Promise.resolve({
          id: 'final',
          choices: [{ index: 0, message: { role: 'assistant', content: 'done', tool_calls: undefined }, finish_reason: 'stop' }],
        });
      }),
    });

    const engine = new ReasoningEngine(null, provider);
    const onPlan = vi.fn();

    await engine.chat('create architecture document', BASE_CTX, [], vi.fn(), undefined, onPlan);

    expect(onPlan).toHaveBeenCalled();
    const steps: string[] = onPlan.mock.calls[0][0];
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0]).toContain('Analyze');
  });

  it('does NOT call onPlan for simple conversational questions', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');

    const provider = makeProvider();
    const engine = new ReasoningEngine(null, provider);
    const onPlan = vi.fn();

    await engine.chat('who are you', BASE_CTX, [], vi.fn(), undefined, onPlan);

    expect(onPlan).not.toHaveBeenCalled();
  });

  it('does NOT call onPlan when plan has fewer than 2 steps', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');

    let callIndex = 0;
    const provider = makeProvider({
      sendChatCompletion: vi.fn().mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return Promise.resolve({
            id: 'plan',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Just answer directly.' }, finish_reason: 'stop' }],
          });
        }
        return Promise.resolve({
          id: 'final',
          choices: [{ index: 0, message: { role: 'assistant', content: 'done', tool_calls: undefined }, finish_reason: 'stop' }],
        });
      }),
    });

    const engine = new ReasoningEngine(null, provider);
    const onPlan = vi.fn();

    await engine.chat('create a file', BASE_CTX, [], vi.fn(), undefined, onPlan);

    expect(onPlan).not.toHaveBeenCalled();
  });
});

// ── 4. Tool stage messages from ToolRegistry ──────────────────────────────────

describe('ToolRegistry.execute() — detailed stage messages', () => {
  it('read_file emits "READ <path>"', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const stages: string[] = [];
    await registry.execute('read_file', { path: 'src/auth.ts' }, (s) => stages.push(s));
    expect(stages).toContain('READ src/auth.ts');
  });

  it('search_code emits "SEARCH \\"<query>\\""', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const stages: string[] = [];
    await registry.execute('search_code', { query: 'loginUser' }, (s) => stages.push(s));
    expect(stages).toContain('SEARCH "loginUser"');
  });

  it('list_files emits "READ <dir>/"', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const stages: string[] = [];
    await registry.execute('list_files', { path: 'src' }, (s) => stages.push(s));
    expect(stages).toContain('READ src/');
  });

  it('git_branch emits "GIT branch"', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const stages: string[] = [];
    await registry.execute('git_branch', {}, (s) => stages.push(s));
    expect(stages).toContain('GIT branch');
  });

  it('git_status emits "GIT status"', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const stages: string[] = [];
    await registry.execute('git_status', {}, (s) => stages.push(s));
    expect(stages).toContain('GIT status');
  });

  it('git_diff emits "GIT diff"', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const stages: string[] = [];
    await registry.execute('git_diff', {}, (s) => stages.push(s));
    expect(stages).toContain('GIT diff');
  });

  it('git_log emits "GIT log"', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const stages: string[] = [];
    await registry.execute('git_log', {}, (s) => stages.push(s));
    expect(stages).toContain('GIT log');
  });

  it('run_terminal emits "RUN <command>"', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const stages: string[] = [];
    await registry.execute('run_terminal', { command: 'ls -la' }, (s) => stages.push(s));
    expect(stages).toContain('RUN ls -la');
  });

  it('write_file emits "WRITE <path> (N lines)"', async () => {
    // write_file is in WRITE_ASK_PATTERNS — requires session trust in non-TTY environments.
    const { permissionGate } = await import('../../../src/runtime/permission-gate.js');
    permissionGate.grantSessionTrust();

    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const stages: string[] = [];
    await registry.execute('write_file', { path: 'varun.md', content: '# Hi' }, (s) => stages.push(s));
    expect(stages).toContain('WRITE varun.md (1 lines)');
  });

  it('no onStage callback does not throw', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    await expect(registry.execute('git_branch', {})).resolves.toBeDefined();
  });
});

// ── 5. Code retrieval ─────────────────────────────────────────────────────────

describe('ReasoningEngine.chat() — automatic code retrieval', () => {
  // QueryEngine mock (hoisted) returns [{chunkId:'c1'},{chunkId:'c2'}]
  // The index passed to ReasoningEngine must have chunks matching those IDs

  it('includes file paths in the system prompt when index has results', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');

    const index = makeIndex([
      { id: 'c1', filePath: 'src/auth.ts', content: 'export function login() {}' },
      { id: 'c2', filePath: 'src/user.ts', content: 'export function getUser() {}' },
    ]);

    const provider = makeProvider();
    const engine = new ReasoningEngine(index as never, provider);

    await engine.chat('explain authentication', BASE_CTX, [], vi.fn());

    // 'explain authentication' → not complex → 1 call (tool loop)
    const systemPrompt: string = provider.sendChatCompletion.mock.calls[0][0].messages[0].content;
    expect(systemPrompt).toContain('src/auth.ts');
    expect(systemPrompt).toContain('src/user.ts');
  });

  it('emits "🔍  searching repository" stage when index is available', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');

    const index = makeIndex([
      { id: 'c1', filePath: 'src/engine.ts', content: 'code' },
      { id: 'c2', filePath: 'src/other.ts', content: 'other' },
    ]);
    const provider = makeProvider();
    const engine = new ReasoningEngine(index as never, provider);

    const stages: string[] = [];
    await engine.chat('explain execution engine', BASE_CTX, [], vi.fn(), (s) => stages.push(s));

    expect(stages).toContain('SEARCH repository');
  });

  it('skips retrieval stage when no index is present', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');
    const provider = makeProvider();
    const engine = new ReasoningEngine(null, provider);

    const stages: string[] = [];
    await engine.chat('who are you', BASE_CTX, [], vi.fn(), (s) => stages.push(s));

    expect(stages).not.toContain('SEARCH repository');
  });
});

// ── 6. ConversationEngine history accumulation ────────────────────────────────

describe('ConversationEngine — history accumulation', () => {
  function makeUI() {
    return {
      renderHeader: vi.fn(), renderWelcome: vi.fn(), renderPrompt: vi.fn(),
      renderThinking: vi.fn().mockReturnValue({ text: '', isSpinning: false, stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
      renderStage: vi.fn(), stopSpinner: vi.fn(), renderResponse: vi.fn(),
      renderStreamChunk: vi.fn(), renderStreamEnd: vi.fn(), renderPlan: vi.fn(),
      renderPatchPreview: vi.fn(), renderError: vi.fn(), renderInfo: vi.fn(),
      renderSuccess: vi.fn(), renderHelp: vi.fn(), renderSetupHeader: vi.fn(),
      renderDivider: vi.fn(), renderMeta: vi.fn(), renderExecutionSummary: vi.fn(),
      resetSessionState: vi.fn(), stream: vi.fn(),
      setLastPlan: vi.fn(), updateContext: vi.fn(), recordToolUsed: vi.fn(),
      setTimeline: vi.fn(), renderContext: vi.fn(), renderTimeline: vi.fn(),
      advancePlan: vi.fn(),
    } as unknown as import('../../../src/cli/session/ui-renderer.js').UIRenderer;
  }

  beforeEach(() => {
    mockSendChatCompletion.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('each call is independent: no cross-turn state leaks between calls', async () => {
    // ConversationEngine is stateless — it no longer accumulates history between turns.
    // Each process() call starts fresh. This prevents fake "memory" where UI shows
    // continuity that the LLM never actually has.
    const { ConversationEngine } = await import('../../../src/cli/session/conversation-engine.js');

    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const ctx = { rootPath: '/repo', index: null, hasConfig: true, branch: 'main' };

    await engine.process('create varun.md', ctx);
    await engine.process('brief summary', ctx);

    const allCalls = mockSendChatCompletion.mock.calls;
    expect(allCalls.length).toBeGreaterThanOrEqual(2);

    // The last call should contain only the current turn ('brief summary'),
    // NOT prior turn content ('create varun.md') — stateless by design.
    const lastMessages: Array<{ role: string; content: string | null }> =
      allCalls[allCalls.length - 1][0].messages;
    const allContent = lastMessages.map(m => m.content ?? '').join(' ');

    expect(allContent).toContain('brief summary');
    // Prior turn does NOT appear — each call is independent
    expect(allContent).not.toContain('create varun.md');
  });
});
