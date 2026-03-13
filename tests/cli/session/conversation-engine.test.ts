import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationEngine } from '../../../src/cli/session/conversation-engine.js';
import { UIRenderer } from '../../../src/cli/session/ui-renderer.js';
import type { ConversationContext } from '../../../src/cli/session/conversation-engine.js';
import type { RepoIndex } from '../../../src/types/index.js';

// Mock external I/O modules
vi.mock('../../../src/store/index-store.js', () => ({
  loadIndex: vi.fn(),
  loadIndexMetadata: vi.fn().mockResolvedValue({
    version: '1',
    createdAt: '2026-01-01',
    rootPath: '/project',
    fileCount: 42,
    chunkCount: 300,
    edgeCount: 120,
  }),
}));

vi.mock('../../../src/ai/config-store.js', () => ({
  configExists: vi.fn().mockResolvedValue(false),
  loadConfig: vi.fn(),
}));

vi.mock('../../../src/ai/providers/azure-provider.js', () => ({
  AzureAIProvider: vi.fn(),
}));

vi.mock('../../../src/ai/reasoning/reasoning-engine.js', () => ({
  ReasoningEngine: vi.fn(),
}));

vi.mock('../../../src/execution/execution-engine.js', () => ({
  ExecutionEngine: vi.fn(),
}));

vi.mock('../../../src/search/query-engine.js', () => {
  class QueryEngine {
    search(_query: string, _limit?: number) { return [] as ReturnType<InstanceType<typeof QueryEngine>['search']>; }
  }
  return { QueryEngine };
});

function makeUI(): UIRenderer {
  return {
    renderHeader: vi.fn(),
    renderWelcome: vi.fn(),
    renderPrompt: vi.fn(),
    renderThinking: vi.fn().mockReturnValue({ text: '', isSpinning: false, stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
    renderStage: vi.fn(),
    stopSpinner: vi.fn(),
    renderResponse: vi.fn(),
    renderStreamChunk: vi.fn(),
    renderStreamEnd: vi.fn(),
    renderPlan: vi.fn(),
    renderPatchPreview: vi.fn(),
    renderError: vi.fn(),
    renderInfo: vi.fn(),
    renderSuccess: vi.fn(),
    renderHelp: vi.fn(),
    renderSetupHeader: vi.fn(),
    renderDivider: vi.fn(),
    renderMeta: vi.fn(),
  } as unknown as UIRenderer;
}

function makeCtx(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    rootPath: '/project',
    index: null,
    hasConfig: false,
    ...overrides,
  };
}

describe('ConversationEngine', () => {
  let ui: UIRenderer;
  let engine: ConversationEngine;

  beforeEach(() => {
    ui = makeUI();
    engine = new ConversationEngine(ui);
    vi.clearAllMocks();
  });

  it('returns shouldQuit=true for "quit"', async () => {
    const result = await engine.process('quit', makeCtx());
    expect(result.shouldQuit).toBe(true);
    expect(result.handled).toBe(true);
  });

  it('returns shouldQuit=true for "exit"', async () => {
    const result = await engine.process('exit', makeCtx());
    expect(result.shouldQuit).toBe(true);
  });

  it('calls renderHelp for "help"', async () => {
    const result = await engine.process('help', makeCtx());
    expect(result.shouldQuit).toBe(false);
    expect(ui.renderHelp).toHaveBeenCalled();
  });

  it('shows error when no index for explain', async () => {
    const result = await engine.process('explain authentication', makeCtx({ index: null }));
    expect(result.handled).toBe(true);
    expect(ui.renderError).toHaveBeenCalled();
  });

  it('shows error when no config for build', async () => {
    const result = await engine.process('add JWT authentication', makeCtx({ hasConfig: false }));
    expect(result.handled).toBe(true);
    expect(ui.renderError).toHaveBeenCalled();
  });

  it('shows status from index metadata', async () => {
    const result = await engine.process('status', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.shouldQuit).toBe(false);
  });

  it('falls back to search when no AI config', async () => {
    const fakeIndex = {
      chunks: [
        {
          id: 'chunk-1',
          filePath: 'src/auth.ts',
          name: 'loginUser',
          type: 'function',
          content: 'async function loginUser() {}',
          startLine: 1,
          endLine: 5,
          language: 'typescript',
        },
      ],
      metadata: { version: '1', createdAt: '', rootPath: '/project', fileCount: 1, chunkCount: 1, edgeCount: 0 },
      files: [],
      edges: [],
      nodes: [],
      vectors: [],
      vocabulary: { terms: [], termToIndex: {} },
    } as unknown as RepoIndex;

    const { QueryEngine } = await import('../../../src/search/query-engine.js');
    vi.spyOn(QueryEngine.prototype, 'search').mockReturnValue(
      [{ chunkId: 'chunk-1', score: 0.9 }] as ReturnType<InstanceType<typeof QueryEngine>['search']>,
    );

    const result = await engine.process(
      'explain login',
      makeCtx({ index: fakeIndex, hasConfig: false }),
    );
    expect(result.handled).toBe(true);
  });

  it('handles unrecognized input gracefully (defaults to explain)', async () => {
    const result = await engine.process('show me the architecture', makeCtx({ index: null }));
    expect(result.handled).toBe(true);
    // No index → error shown
    expect(ui.renderError).toHaveBeenCalled();
  });
});
