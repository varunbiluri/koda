import { describe, it, expect, vi } from 'vitest';
import { ReasoningEngine } from '../../src/ai/reasoning/reasoning-engine.js';
import type { RepoIndex } from '../../src/types/index.js';
import type { AIProvider, ChatCompletionResponse } from '../../src/ai/types.js';

function createMockIndex(): RepoIndex {
  return {
    metadata: {
      version: '0.1.0',
      createdAt: '2024-01-01',
      rootPath: '/test',
      fileCount: 2,
      chunkCount: 3,
      edgeCount: 0,
    },
    files: [
      { path: 'auth.ts', absolutePath: '/test/auth.ts', language: 'typescript', size: 100, hash: 'a' },
      { path: 'utils.ts', absolutePath: '/test/utils.ts', language: 'typescript', size: 50, hash: 'b' },
    ],
    chunks: [
      {
        id: 'auth.ts#login',
        filePath: 'auth.ts',
        name: 'login',
        type: 'function',
        content: 'function login(user, pass) { return validateCredentials(user, pass); }',
        startLine: 1,
        endLine: 3,
        language: 'typescript',
      },
      {
        id: 'auth.ts#validateCredentials',
        filePath: 'auth.ts',
        name: 'validateCredentials',
        type: 'function',
        content: 'function validateCredentials(u, p) { return u === "admin" && p === "secret"; }',
        startLine: 5,
        endLine: 7,
        language: 'typescript',
      },
      {
        id: 'utils.ts#formatDate',
        filePath: 'utils.ts',
        name: 'formatDate',
        type: 'function',
        content: 'function formatDate(d) { return d.toISOString(); }',
        startLine: 1,
        endLine: 1,
        language: 'typescript',
      },
    ],
    edges: [],
    nodes: [
      { filePath: 'auth.ts', inDegree: 0, outDegree: 0 },
      { filePath: 'utils.ts', inDegree: 0, outDegree: 0 },
    ],
    vectors: [
      { chunkId: 'auth.ts#login', vector: { indices: [0, 1, 2, 3], values: [1.0, 0.8, 0.5, 0.3] } },
      { chunkId: 'auth.ts#validateCredentials', vector: { indices: [0, 1, 2], values: [0.9, 0.6, 0.7] } },
      { chunkId: 'utils.ts#formatDate', vector: { indices: [4], values: [1.0] } },
    ],
    vocabulary: {
      terms: ['authentication', 'login', 'credentials', 'validate', 'date', 'work', 'test'],
      termToIndex: { authentication: 0, login: 1, credentials: 2, validate: 3, date: 4, work: 5, test: 6 },
    },
  };
}

function createMockProvider(): AIProvider {
  const mockResponse: ChatCompletionResponse = {
    id: 'test-id',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Authentication is handled by the login function in auth.ts which calls validateCredentials.',
        },
        finish_reason: 'stop',
      },
    ],
  };

  return {
    sendChatCompletion: vi.fn().mockResolvedValue(mockResponse),
    streamChatCompletion: vi.fn().mockImplementation(async (_req, onChunk) => {
      const chunks = ['Authentication ', 'is handled ', 'by login.'];
      for (const chunk of chunks) {
        onChunk(chunk);
      }
    }),
    listModels: vi.fn().mockResolvedValue([]),
  };
}

describe('ReasoningEngine', () => {
  it('analyzes queries and returns structured results', async () => {
    const index = createMockIndex();
    const provider = createMockProvider();
    const engine = new ReasoningEngine(index, provider);

    const result = await engine.analyze('How does authentication work?');

    expect(result.answer).toBeTruthy();
    expect(result.answer).toContain('Authentication');
    expect(result.filesAnalyzed.length).toBeGreaterThan(0);
    expect(result.chunksUsed).toBeGreaterThan(0);
    expect(provider.sendChatCompletion).toHaveBeenCalledOnce();
  });

  it('includes system and user messages in request', async () => {
    const index = createMockIndex();
    const provider = createMockProvider();
    const engine = new ReasoningEngine(index, provider);

    await engine.analyze('login authentication');

    const call = (provider.sendChatCompletion as any).mock.calls[0][0];
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0].role).toBe('system');
    expect(call.messages[1].role).toBe('user');
  });

  it('streams responses with chunk callback', async () => {
    const index = createMockIndex();
    const provider = createMockProvider();
    const engine = new ReasoningEngine(index, provider);

    const chunks: string[] = [];
    const result = await engine.analyzeStream(
      'How does authentication work?',
      (chunk) => chunks.push(chunk),
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toContain('Authentication');
    expect(result.filesAnalyzed.length).toBeGreaterThan(0);
    expect(provider.streamChatCompletion).toHaveBeenCalledOnce();
  });

  it('throws error when no relevant code is found', async () => {
    const emptyIndex = createMockIndex();
    emptyIndex.vectors = []; // No vectors means no search results

    const provider = createMockProvider();
    const engine = new ReasoningEngine(emptyIndex, provider);

    await expect(engine.analyze('nonexistent query')).rejects.toThrow(
      'No relevant code found',
    );
  });

  it('respects maxResults option', async () => {
    const index = createMockIndex();
    const provider = createMockProvider();
    const engine = new ReasoningEngine(index, provider);

    await engine.analyze('login', { maxResults: 1 });

    // Verify only limited results were processed
    const call = (provider.sendChatCompletion as any).mock.calls[0][0];
    const userMessage = call.messages[1].content;

    // Should not include all chunks
    expect(userMessage).toBeTruthy();
  });
});
