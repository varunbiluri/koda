/**
 * Tests for Phase 9 execution metrics:
 *
 *  1. chat() returns ChatMetrics with tools, tokens, duration
 *  2. toolCount increments only for executed (non-protected) tools
 *  3. totalTokens accumulates from planning + loop responses
 *  4. duration is non-negative
 *  5. renderExecutionSummary formats output correctly
 *  6. ConversationEngine calls renderExecutionSummary after AI response
 *  7. Session loop continues after a command (no premature exit)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mock variables ───────────────────────────────────────────────

const mockSendForMetrics = vi.fn().mockResolvedValue({
  id: 'r1',
  choices: [{
    index: 0,
    message: { role: 'assistant', content: 'task done', tool_calls: undefined },
    finish_reason: 'stop',
  }],
  usage: { prompt_tokens: 500, completion_tokens: 300, total_tokens: 800 },
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/tools/filesystem-tools.js', () => ({
  readFile: vi.fn().mockResolvedValue({ success: true, data: 'content' }),
  writeFile: vi.fn().mockResolvedValue({ success: true }),
  searchCode: vi.fn().mockResolvedValue({ success: true, data: [] }),
  listFiles: vi.fn().mockResolvedValue({ success: true, data: ['src'] }),
}));

vi.mock('../../../src/tools/git-tools.js', () => ({
  gitBranch: vi.fn().mockResolvedValue({ success: true, data: 'main' }),
  gitStatus: vi.fn().mockResolvedValue({ success: true, data: '' }),
  gitDiff: vi.fn().mockResolvedValue({ success: true, data: '' }),
  gitLog: vi.fn().mockResolvedValue({ success: true, data: 'commit' }),
}));

vi.mock('../../../src/tools/terminal-tools.js', () => ({
  runTerminal: vi.fn().mockResolvedValue({ success: true, data: { stdout: '', stderr: '', exitCode: 0 } }),
}));

vi.mock('../../../src/search/query-engine.js', () => {
  class QueryEngine { search() { return []; } }
  return { QueryEngine };
});

vi.mock('../../../src/store/index-store.js', () => ({
  loadIndex: vi.fn(),
  loadIndexMetadata: vi.fn().mockResolvedValue({
    version: '1', createdAt: '', rootPath: '/repo',
    fileCount: 5, chunkCount: 20, edgeCount: 10,
  }),
}));

vi.mock('../../../src/ai/config-store.js', () => ({
  configExists: vi.fn().mockResolvedValue(true),
  loadConfig: vi.fn().mockResolvedValue({
    provider: 'azure', endpoint: 'https://test.openai.azure.com',
    apiKey: 'k', model: 'gpt-4o', apiVersion: '2024-05-01-preview',
  }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/ai/providers/azure-provider.js', () => {
  class AzureAIProvider {
    sendChatCompletion = mockSendForMetrics;
    streamChatCompletion = vi.fn();
    listModels = vi.fn().mockResolvedValue([]);
    testConnection = vi.fn().mockResolvedValue(undefined);
  }
  return { AzureAIProvider };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProvider(overrides: Partial<{ sendChatCompletion: ReturnType<typeof vi.fn> }> = {}) {
  return {
    sendChatCompletion: vi.fn().mockResolvedValue({
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok', tool_calls: undefined }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }),
    streamChatCompletion: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const BASE_CTX = { repoName: 'koda', branch: 'main', rootPath: '/repo', fileCount: 5 };

// ── 1. chat() returns ChatMetrics ─────────────────────────────────────────────

describe('ReasoningEngine.chat() — returns ChatMetrics', () => {
  it('returns an object with tools, tokens, duration fields', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');
    const provider = makeProvider();
    const engine = new ReasoningEngine(null, provider);

    const metrics = await engine.chat('who are you', BASE_CTX, [], vi.fn());

    expect(metrics).toBeDefined();
    expect(typeof metrics.tools).toBe('number');
    expect(typeof metrics.tokens).toBe('number');
    expect(typeof metrics.duration).toBe('number');
  });

  it('duration is non-negative', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');
    const provider = makeProvider();
    const engine = new ReasoningEngine(null, provider);

    const metrics = await engine.chat('hello', BASE_CTX, [], vi.fn());

    expect(metrics.duration).toBeGreaterThanOrEqual(0);
  });

  it('tools is 0 when no tool calls were made', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');
    const provider = makeProvider(); // always returns stop, no tool_calls
    const engine = new ReasoningEngine(null, provider);

    const metrics = await engine.chat('hello', BASE_CTX, [], vi.fn());

    expect(metrics.tools).toBe(0);
  });

  it('tokens accumulates from provider usage', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');
    const provider = makeProvider({
      sendChatCompletion: vi.fn().mockResolvedValue({
        id: 'r1',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok', tool_calls: undefined }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 400, completion_tokens: 200, total_tokens: 600 },
      }),
    });
    const engine = new ReasoningEngine(null, provider);

    const metrics = await engine.chat('hello', BASE_CTX, [], vi.fn());

    expect(metrics.tokens).toBe(600); // 400 + 200
  });

  it('tokens is 0 when provider returns no usage', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');
    const provider = makeProvider({
      sendChatCompletion: vi.fn().mockResolvedValue({
        id: 'r1',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        // no usage field
      }),
    });
    const engine = new ReasoningEngine(null, provider);

    const metrics = await engine.chat('hello', BASE_CTX, [], vi.fn());

    expect(metrics.tokens).toBe(0);
  });
});

// ── 2. toolCount increments on tool execution ─────────────────────────────────

describe('ReasoningEngine.chat() — toolCount', () => {
  it('increments once per executed tool call', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');

    let call = 0;
    const provider = makeProvider({
      sendChatCompletion: vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          // First call: AI requests git_branch
          return Promise.resolve({
            id: 'r1',
            choices: [{
              index: 0,
              message: {
                role: 'assistant', content: null,
                tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'git_branch', arguments: '{}' } }],
              },
              finish_reason: 'tool_calls',
            }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          });
        }
        // Second call: final answer
        return Promise.resolve({
          id: 'r2',
          choices: [{ index: 0, message: { role: 'assistant', content: 'branch is main' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 150, completion_tokens: 60, total_tokens: 210 },
        });
      }),
    });

    const engine = new ReasoningEngine(null, provider);
    const metrics = await engine.chat('what branch', BASE_CTX, [], vi.fn());

    expect(metrics.tools).toBe(1);
  });

  it('counts two tool calls correctly', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');

    let call = 0;
    const provider = makeProvider({
      sendChatCompletion: vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.resolve({
            id: 'r1',
            choices: [{
              index: 0,
              message: {
                role: 'assistant', content: null,
                tool_calls: [
                  { id: 'tc1', type: 'function', function: { name: 'git_branch', arguments: '{}' } },
                  { id: 'tc2', type: 'function', function: { name: 'git_status', arguments: '{}' } },
                ],
              },
              finish_reason: 'tool_calls',
            }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          });
        }
        return Promise.resolve({
          id: 'r2',
          choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
        });
      }),
    });

    const engine = new ReasoningEngine(null, provider);
    const metrics = await engine.chat('git info', BASE_CTX, [], vi.fn());

    expect(metrics.tools).toBe(2);
    expect(metrics.tokens).toBe(430); // 150 + 280
  });
});

// ── 3. planning tokens are accumulated ───────────────────────────────────────

describe('ReasoningEngine.chat() — planning token accumulation', () => {
  it('adds planning response tokens to total', async () => {
    const { ReasoningEngine } = await import('../../../src/ai/reasoning/reasoning-engine.js');

    let call = 0;
    const provider = makeProvider({
      sendChatCompletion: vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          // Planning call (triggered by action verb "create" + 3 words)
          return Promise.resolve({
            id: 'plan',
            choices: [{ index: 0, message: { role: 'assistant', content: '1. Step one\n2. Step two' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
          });
        }
        // Tool loop call
        return Promise.resolve({
          id: 'final',
          choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 300, completion_tokens: 150, total_tokens: 450 },
        });
      }),
    });

    const engine = new ReasoningEngine(null, provider);
    // 'create architecture document' triggers planning (action verb + 3 words)
    const metrics = await engine.chat('create architecture document', BASE_CTX, [], vi.fn());

    // 300 (planning) + 450 (tool loop) = 750
    expect(metrics.tokens).toBe(750);
  });
});

// ── 4. UIRenderer.renderExecutionSummary ──────────────────────────────────────

describe('UIRenderer.renderExecutionSummary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('outputs "Done (N tools · Nk tokens · Ns)"', async () => {
    const { UIRenderer } = await import('../../../src/cli/session/ui-renderer.js');
    const renderer = new UIRenderer();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    renderer.renderExecutionSummary({ tools: 4, tokens: 3000, duration: 6 });

    expect(logs.some(l => l.includes('Done'))).toBe(true);
    expect(logs.some(l => l.includes('4 tools'))).toBe(true);
    expect(logs.some(l => l.includes('3k tokens'))).toBe(true);
    expect(logs.some(l => l.includes('6s'))).toBe(true);
  });

  it('rounds token count to nearest k', async () => {
    const { UIRenderer } = await import('../../../src/cli/session/ui-renderer.js');
    const renderer = new UIRenderer();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    renderer.renderExecutionSummary({ tools: 1, tokens: 11400, duration: 7 });

    expect(logs.some(l => l.includes('11k tokens'))).toBe(true);
  });

  it('shows 0 tools when no tools were used', async () => {
    const { UIRenderer } = await import('../../../src/cli/session/ui-renderer.js');
    const renderer = new UIRenderer();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });

    renderer.renderExecutionSummary({ tools: 0, tokens: 500, duration: 2 });

    expect(logs.some(l => l.includes('0 tools'))).toBe(true);
  });
});

// ── 5. ConversationEngine calls renderExecutionSummary ────────────────────────

describe('ConversationEngine — renderExecutionSummary integration', () => {
  function makeUI() {
    return {
      renderHeader: vi.fn(), renderWelcome: vi.fn(), renderPrompt: vi.fn(),
      renderThinking: vi.fn().mockReturnValue({ text: '', isSpinning: false, stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
      renderStage: vi.fn(), stopSpinner: vi.fn(), renderResponse: vi.fn(),
      renderStreamChunk: vi.fn(), renderStreamEnd: vi.fn(), renderPlan: vi.fn(),
      renderPatchPreview: vi.fn(), renderError: vi.fn(), renderInfo: vi.fn(),
      renderSuccess: vi.fn(), renderHelp: vi.fn(), renderSetupHeader: vi.fn(),
      renderDivider: vi.fn(), renderMeta: vi.fn(), renderExecutionSummary: vi.fn(), stream: vi.fn(),
    } as unknown as import('../../../src/cli/session/ui-renderer.js').UIRenderer;
  }

  beforeEach(() => {
    mockSendForMetrics.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('calls renderExecutionSummary after AI response', async () => {
    const { ConversationEngine } = await import('../../../src/cli/session/conversation-engine.js');
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const ctx = { rootPath: '/repo', index: null, hasConfig: true, branch: 'main' };

    // 'explain auth' is not a greeting and not a quit — routes to handleWithAI
    await engine.process('explain auth module', ctx);

    // renderExecutionSummary should have been called with metrics object
    expect(ui.renderExecutionSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.any(Number),
        tokens: expect.any(Number),
        duration: expect.any(Number),
      }),
    );
  });

  it('renderExecutionSummary is called after renderStreamEnd', async () => {
    const { ConversationEngine } = await import('../../../src/cli/session/conversation-engine.js');
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const ctx = { rootPath: '/repo', index: null, hasConfig: true, branch: 'main' };

    const callOrder: string[] = [];
    (ui.renderStreamEnd as ReturnType<typeof vi.fn>).mockImplementation(() => { callOrder.push('renderStreamEnd'); });
    (ui.renderExecutionSummary as ReturnType<typeof vi.fn>).mockImplementation(() => { callOrder.push('renderExecutionSummary'); });

    await engine.process('explain auth module', ctx);

    const endIdx = callOrder.indexOf('renderStreamEnd');
    const summaryIdx = callOrder.indexOf('renderExecutionSummary');
    expect(endIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeGreaterThan(endIdx);
  });

  it('session loop continues (process returns handled=true, shouldQuit=false)', async () => {
    const { ConversationEngine } = await import('../../../src/cli/session/conversation-engine.js');
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const ctx = { rootPath: '/repo', index: null, hasConfig: true, branch: 'main' };

    const result1 = await engine.process('first command', ctx);
    const result2 = await engine.process('second command', ctx);

    expect(result1.shouldQuit).toBe(false);
    expect(result2.shouldQuit).toBe(false);
    expect(result1.handled).toBe(true);
    expect(result2.handled).toBe(true);
  });

  it('renderExecutionSummary is NOT called for quit command', async () => {
    const { ConversationEngine } = await import('../../../src/cli/session/conversation-engine.js');
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const ctx = { rootPath: '/repo', index: null, hasConfig: true, branch: 'main' };

    await engine.process('quit', ctx);

    expect(ui.renderExecutionSummary).not.toHaveBeenCalled();
  });
});
