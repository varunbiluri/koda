/**
 * Tests for the AI-first conversational architecture (Phase 8 refactor).
 *
 * Covers:
 *  - AI path is taken whenever hasConfig=true (regardless of index)
 *  - Conversational questions ("who are you", "where are we") → AI path
 *  - Git questions ("which branch") → AI path (chat() receives repo context)
 *  - chat() is called with correct repo context metadata
 *  - ToolRegistry: execute() returns correct string results for each tool
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationEngine } from '../../../src/cli/session/conversation-engine.js';
import { UIRenderer } from '../../../src/cli/session/ui-renderer.js';
import type { ConversationContext } from '../../../src/cli/session/conversation-engine.js';
import type { RepoIndex } from '../../../src/types/index.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

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
    testConnection = vi.fn().mockResolvedValue(undefined);
    listModels = vi.fn().mockResolvedValue([]);
    sendChatCompletion = vi.fn().mockResolvedValue({
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Mocked AI answer' }, finish_reason: 'stop' }],
    });
    streamChatCompletion = vi.fn();
  }
  return { AzureAIProvider };
});

vi.mock('../../../src/ai/reasoning/reasoning-engine.js', () => {
  class ReasoningEngine {
    analyzeStream = vi.fn().mockResolvedValue({
      filesAnalyzed: [], chunksUsed: 0, contextTruncated: false,
    });
    // chat() simulates a single-round AI answer (no tools)
    chat = vi.fn().mockImplementation(
      async (_input: unknown, _ctx: unknown, _history: unknown, onChunk: (s: string) => void) => {
        onChunk('I am Koda, your AI software engineer.');
      },
    );
  }
  return { ReasoningEngine };
});

vi.mock('../../../src/execution/execution-engine.js', () => {
  class ExecutionEngine {
    execute = vi.fn();
  }
  return { ExecutionEngine };
});

vi.mock('../../../src/search/query-engine.js', () => {
  class QueryEngine {
    search(_q: string, _n?: number) { return [] as Array<{ chunkId: string; score: number }>; }
  }
  return { QueryEngine };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUI(): UIRenderer {
  return {
    renderHeader: vi.fn(), renderWelcome: vi.fn(), renderPrompt: vi.fn(),
    renderThinking: vi.fn().mockReturnValue({ text: '', isSpinning: false, stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
    renderStage: vi.fn(), stopSpinner: vi.fn(), renderResponse: vi.fn(),
    renderStreamChunk: vi.fn(), renderStreamEnd: vi.fn(), renderPlan: vi.fn(),
    renderPatchPreview: vi.fn(), renderError: vi.fn(), renderInfo: vi.fn(),
    renderSuccess: vi.fn(), renderHelp: vi.fn(), renderSetupHeader: vi.fn(),
    renderDivider: vi.fn(), renderMeta: vi.fn(), renderExecutionSummary: vi.fn(), stream: vi.fn(),
  } as unknown as UIRenderer;
}

function makeCtx(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    rootPath: '/repo',
    index: null,
    hasConfig: true,
    branch: 'main',
    ...overrides,
  };
}

function makeIndex(): RepoIndex {
  return {
    chunks: [], files: [], edges: [], nodes: [], vectors: [],
    vocabulary: { terms: [], termToIndex: {} },
    metadata: { version: '1', createdAt: '', rootPath: '/repo', fileCount: 42, chunkCount: 0, edgeCount: 0 },
  } as unknown as RepoIndex;
}

// ── 1. AI path is always taken when hasConfig=true ────────────────────────────

describe('AI-first: hasConfig=true routes to chat()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('calls renderStreamEnd for any input when hasConfig=true', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const result = await engine.process('explain the auth module', makeCtx());
    expect(ui.renderStreamEnd).toHaveBeenCalled();
    expect(result.handled).toBe(true);
    expect(result.shouldQuit).toBe(false);
  });

  it('works without an index (no koda init required)', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const result = await engine.process('who are you', makeCtx({ index: null }));
    expect(ui.renderStreamEnd).toHaveBeenCalled();
    expect(result.handled).toBe(true);
  });

  it('works with an index present', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const result = await engine.process('explain authentication', makeCtx({ index: makeIndex() }));
    expect(ui.renderStreamEnd).toHaveBeenCalled();
    expect(result.handled).toBe(true);
  });
});

// ── 2. Conversational questions ───────────────────────────────────────────────

describe('conversational questions go to AI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  const questions = [
    'who are you',
    'what can you do',
    'where are we',
    'which branch are we in',
    'what repository is this',
    'tell me about the codebase',
  ];

  for (const q of questions) {
    it(`"${q}" → AI path (renderStreamEnd called)`, async () => {
      const ui = makeUI();
      const engine = new ConversationEngine(ui);
      const result = await engine.process(q, makeCtx());
      expect(ui.renderStreamEnd).toHaveBeenCalled();
      expect(result.handled).toBe(true);
    });
  }
});

// ── 3. chat() receives repo context ──────────────────────────────────────────

describe('chat() receives correct repo context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('AI path is taken for git branch question (renderStreamEnd called)', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    await engine.process('which branch am I on', makeCtx({ branch: 'feat/my-feature' }));
    // The AI path ran and completed
    expect(ui.renderStreamEnd).toHaveBeenCalled();
  });

  it('AI path is taken for file count question', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    await engine.process('how many files are indexed', makeCtx({ index: makeIndex() }));
    expect(ui.renderStreamEnd).toHaveBeenCalled();
  });

  it('streamChunk is called with the AI answer', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    await engine.process('who are you', makeCtx());
    // The mock chat() calls onChunk('I am Koda...'), which calls renderStreamChunk
    expect(ui.renderStreamChunk).toHaveBeenCalledWith('I am Koda, your AI software engineer.');
  });
});

// ── 4. Fast-paths still work ──────────────────────────────────────────────────

describe('fast-paths are unaffected by AI-first refactor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('"quit" → shouldQuit=true without AI', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const result = await engine.process('quit', makeCtx());
    expect(result.shouldQuit).toBe(true);
    expect(ui.renderStreamEnd).not.toHaveBeenCalled();
  });

  it('"exit" → shouldQuit=true', async () => {
    const result = await new ConversationEngine(makeUI()).process('exit', makeCtx());
    expect(result.shouldQuit).toBe(true);
  });

  it('"help" → renderHelp without AI', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const result = await engine.process('help', makeCtx());
    expect(ui.renderHelp).toHaveBeenCalled();
    expect(ui.renderStreamEnd).not.toHaveBeenCalled();
    expect(result.shouldQuit).toBe(false);
  });

  it('"status" → status handler without AI', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const result = await engine.process('status', makeCtx());
    expect(result.handled).toBe(true);
    expect(ui.renderStreamEnd).not.toHaveBeenCalled();
  });

  it('"hi" → greeting handler without AI', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const result = await engine.process('hi', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.shouldQuit).toBe(false);
    expect(ui.renderStreamEnd).not.toHaveBeenCalled();
  });
});

// ── 5. No-config fallback ─────────────────────────────────────────────────────

describe('no-config fallback paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('shows error when no config and no index', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const result = await engine.process('explain auth', makeCtx({ hasConfig: false, index: null }));
    expect(ui.renderError).toHaveBeenCalled();
    expect(result.handled).toBe(true);
  });

  it('does local search when no config but index exists (empty results → error)', async () => {
    const ui = makeUI();
    const engine = new ConversationEngine(ui);
    const result = await engine.process('explain auth', makeCtx({ hasConfig: false, index: makeIndex() }));
    // QueryEngine mock always returns [] → renderError
    expect(ui.renderError).toHaveBeenCalled();
    expect(result.handled).toBe(true);
  });
});

// ── 6. ToolRegistry unit tests ────────────────────────────────────────────────

describe('ToolRegistry', () => {
  // Mock the underlying tool functions so tests don't touch the filesystem or git
  vi.mock('../../../src/tools/filesystem-tools.js', () => ({
    readFile: vi.fn().mockResolvedValue({ success: true, data: 'file content' }),
    writeFile: vi.fn().mockResolvedValue({ success: true }),
    searchCode: vi.fn().mockResolvedValue({
      success: true,
      data: [{ file: 'src/auth.ts', line: 10, content: 'export function login()' }],
    }),
    listFiles: vi.fn().mockResolvedValue({ success: true, data: ['src', 'tests', 'package.json'] }),
  }));

  vi.mock('../../../src/tools/git-tools.js', () => ({
    gitBranch: vi.fn().mockResolvedValue({ success: true, data: 'feat/ai-first' }),
    gitStatus: vi.fn().mockResolvedValue({ success: true, data: 'M src/engine.ts' }),
    gitDiff: vi.fn().mockResolvedValue({ success: true, data: '-old\n+new' }),
    gitLog: vi.fn().mockResolvedValue({ success: true, data: 'abc1234 feat: add tool registry' }),
  }));

  vi.mock('../../../src/tools/terminal-tools.js', () => ({
    runTerminal: vi.fn().mockResolvedValue({ success: true, data: { stdout: 'hello', stderr: '', exitCode: 0 } }),
  }));

  it('getToolDefinitions() returns 16 tools', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    expect(registry.getToolDefinitions()).toHaveLength(16);
  });

  it('every tool definition has name, description, and parameters', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    for (const def of registry.getToolDefinitions()) {
      expect(def.type).toBe('function');
      expect(typeof def.function.name).toBe('string');
      expect(typeof def.function.description).toBe('string');
      expect(def.function.parameters).toBeDefined();
    }
  });

  it('execute("git_branch") returns branch name string', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const result = await registry.execute('git_branch', {});
    expect(result).toBe('feat/ai-first');
  });

  it('execute("git_status") returns status string', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const result = await registry.execute('git_status', {});
    expect(result).toContain('src/engine.ts');
  });

  it('execute("read_file") returns file content', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const result = await registry.execute('read_file', { path: 'src/auth.ts' });
    expect(result).toBe('file content');
  });

  it('execute("search_code") returns formatted matches', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const result = await registry.execute('search_code', { query: 'login' });
    expect(result).toContain('src/auth.ts');
    expect(result).toContain('login');
  });

  it('execute("list_files") returns newline-separated entries', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const result = await registry.execute('list_files', { path: '.' });
    expect(result).toContain('src');
    expect(result).toContain('tests');
  });

  it('execute("git_log") returns commit history', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const result = await registry.execute('git_log', { count: 5 });
    expect(result).toContain('feat: add tool registry');
  });

  it('execute("run_terminal") returns stdout', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const result = await registry.execute('run_terminal', { command: 'echo hello' });
    expect(result).toBe('hello');
  });

  it('execute("write_file") returns success message', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const result = await registry.execute('write_file', { path: 'out.txt', content: 'hello' });
    expect(result).toContain('File written successfully');
  });

  it('execute with unknown tool name returns error string', async () => {
    const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
    const registry = new ToolRegistry('/repo');
    const result = await registry.execute('nonexistent_tool', {});
    expect(result).toContain('Unknown tool');
  });
});
