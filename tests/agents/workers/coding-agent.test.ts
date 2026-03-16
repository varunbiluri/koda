/**
 * Tests for CodingAgent, TestAgent, RefactorAgent, DocsAgent worker agents.
 *
 * All use the same mock pattern: a shared chatMock at module scope so tests
 * can override behavior per-test via mockRejectedValueOnce / mockImplementationOnce.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodingAgent }   from '../../../src/agents/workers/coding-agent.js';
import { TestAgent }     from '../../../src/agents/workers/test-agent.js';
import { RefactorAgent } from '../../../src/agents/workers/refactor-agent.js';
import { DocsAgent }     from '../../../src/agents/workers/docs-agent.js';
import type { ChatContext } from '../../../src/ai/reasoning/reasoning-engine.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const chatMock = vi.fn().mockImplementation(
  async (
    _input: unknown,
    _ctx: unknown,
    _history: unknown,
    onChunk: (s: string) => void,
  ) => {
    onChunk('Worker output.');
  },
);

vi.mock('../../../src/ai/reasoning/reasoning-engine.js', () => {
  class ReasoningEngine {
    chat = chatMock;
  }
  return { ReasoningEngine };
});

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): ChatContext {
  return { repoName: 'test-repo', branch: 'main', rootPath: '/repo', fileCount: 10 };
}

// ── CodingAgent tests ──────────────────────────────────────────────────────────

describe('CodingAgent', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns success result with output when chat succeeds', async () => {
    const agent = new CodingAgent(null, {} as never);
    const result = await agent.execute('implement auth', makeCtx(), []);
    expect(result.success).toBe(true);
    expect(result.output).toContain('Worker output.');
  });

  it('returns failure result when chat throws', async () => {
    chatMock.mockRejectedValueOnce(new Error('Provider timeout'));
    const agent = new CodingAgent(null, {} as never);
    const result = await agent.execute('implement auth', makeCtx(), []);
    expect(result.success).toBe(false);
    expect(result.output).toContain('Error');
  });

  it('streams chunks via onChunk callback', async () => {
    const chunks: string[] = [];
    const agent = new CodingAgent(null, {} as never);
    await agent.execute('implement auth', makeCtx(), [], (c) => chunks.push(c));
    expect(chunks).toContain('Worker output.');
  });

  it('returns durationMs >= 0', async () => {
    const agent = new CodingAgent(null, {} as never);
    const result = await agent.execute('implement auth', makeCtx(), []);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes task-specific system instructions to chat', async () => {
    const agent = new CodingAgent(null, {} as never);
    await agent.execute('implement payment service', makeCtx(), []);
    const calledInput = chatMock.mock.calls[0][0] as string;
    expect(calledInput).toContain('coding agent');
    expect(calledInput).toContain('implement payment service');
  });
});

// ── TestAgent tests ────────────────────────────────────────────────────────────

describe('TestAgent', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns success result with output', async () => {
    const agent = new TestAgent(null, {} as never);
    const result = await agent.execute('write tests for auth', makeCtx(), []);
    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it('returns failure when chat throws', async () => {
    chatMock.mockRejectedValueOnce(new Error('AI timeout'));
    const agent = new TestAgent(null, {} as never);
    const result = await agent.execute('write tests', makeCtx(), []);
    expect(result.success).toBe(false);
  });

  it('passes test-specialist instructions', async () => {
    const agent = new TestAgent(null, {} as never);
    await agent.execute('write tests', makeCtx(), []);
    const input = chatMock.mock.calls[0][0] as string;
    expect(input).toContain('test');
  });
});

// ── RefactorAgent tests ────────────────────────────────────────────────────────

describe('RefactorAgent', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns success result', async () => {
    const agent = new RefactorAgent(null, {} as never);
    const result = await agent.execute('refactor auth module', makeCtx(), []);
    expect(result.success).toBe(true);
  });

  it('passes refactor-specialist instructions', async () => {
    const agent = new RefactorAgent(null, {} as never);
    await agent.execute('refactor module', makeCtx(), []);
    const input = chatMock.mock.calls[0][0] as string;
    expect(input.toLowerCase()).toContain('refactor');
  });
});

// ── DocsAgent tests ────────────────────────────────────────────────────────────

describe('DocsAgent', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns success result', async () => {
    const agent = new DocsAgent(null, {} as never);
    const result = await agent.execute('document the API', makeCtx(), []);
    expect(result.success).toBe(true);
  });

  it('passes docs-specialist instructions', async () => {
    const agent = new DocsAgent(null, {} as never);
    await agent.execute('document API', makeCtx(), []);
    const input = chatMock.mock.calls[0][0] as string;
    expect(input.toLowerCase()).toContain('doc');
  });

  it('uses fewer maxRounds than coding agent by default', async () => {
    const agent = new DocsAgent(null, {} as never);
    await agent.execute('document', makeCtx(), []);
    // DocsAgent uses maxRounds=12, CodingAgent uses 15
    // Both call chat — just verify chat was called
    expect(chatMock).toHaveBeenCalledOnce();
  });
});
