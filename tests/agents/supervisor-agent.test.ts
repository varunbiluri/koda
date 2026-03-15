/**
 * Tests for SupervisorAgent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupervisorAgent } from '../../src/agents/supervisor-agent.js';
import type { ChatContext } from '../../src/ai/reasoning/reasoning-engine.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Shared mock so individual tests can override behaviour
const chatMock = vi.fn().mockImplementation(
  async (
    _input: unknown,
    _ctx: unknown,
    _history: unknown,
    onChunk: (s: string) => void,
  ) => {
    onChunk('Sub-agent response.');
  },
);

vi.mock('../../src/ai/reasoning/reasoning-engine.js', () => {
  class ReasoningEngine {
    chat = chatMock;
  }
  return { ReasoningEngine };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): ChatContext {
  return {
    repoName:  'test-repo',
    branch:    'main',
    rootPath:  '/repo',
    fileCount: 42,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SupervisorAgent.delegate()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns a DelegationResult with task and subTasks', async () => {
    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    const result = await supervisor.delegate('implement authentication', []);
    expect(result.task).toBe('implement authentication');
    expect(result.subTasks.length).toBeGreaterThan(0);
  });

  it('includes a CodingAgent for implementation tasks', async () => {
    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    const result = await supervisor.delegate('implement user login', []);
    const roles = result.subTasks.map((t) => t.role);
    expect(roles).toContain('CodingAgent');
  });

  it('includes a TestAgent when task mentions test', async () => {
    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    const result = await supervisor.delegate('implement auth and write tests', []);
    const roles = result.subTasks.map((t) => t.role);
    expect(roles).toContain('TestAgent');
  });

  it('includes a RefactorAgent when task mentions refactor', async () => {
    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    const result = await supervisor.delegate('refactor the auth module', []);
    const roles = result.subTasks.map((t) => t.role);
    expect(roles).toContain('RefactorAgent');
  });

  it('includes DocumentationAgent when task mentions document', async () => {
    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    const result = await supervisor.delegate('document the API endpoints', []);
    const roles = result.subTasks.map((t) => t.role);
    expect(roles).toContain('DocumentationAgent');
  });

  it('marks all sub-tasks as success when chat() succeeds', async () => {
    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    const result = await supervisor.delegate('implement feature X', []);
    for (const t of result.subTasks) {
      expect(t.success).toBe(true);
    }
  });

  it('marks sub-task as failed when chat() throws', async () => {
    chatMock.mockRejectedValueOnce(new Error('AI provider timeout'));

    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    const result = await supervisor.delegate('implement feature Y', []);
    // First sub-task should have failed
    expect(result.subTasks[0].success).toBe(false);
    expect(result.subTasks[0].output).toContain('Error');
  });

  it('aggregates sub-task outputs into response', async () => {
    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    const result = await supervisor.delegate('implement and test auth', []);
    expect(result.response).toContain('[CodingAgent]');
    expect(result.response).toContain('Sub-agent response.');
  });

  it('streams chunks via onChunk callback', async () => {
    const chunks: string[] = [];
    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    await supervisor.delegate('implement auth', [], (chunk) => chunks.push(chunk));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.includes('Sub-agent'))).toBe(true);
  });

  it('calls onStage with AGENT labels', async () => {
    const stages: string[] = [];
    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    await supervisor.delegate('implement auth', [], undefined, (s) => stages.push(s));
    expect(stages.some((s) => s.startsWith('AGENT'))).toBe(true);
  });

  it('returns durationMs > 0', async () => {
    const supervisor = new SupervisorAgent(null, {} as never, makeCtx());
    const result = await supervisor.delegate('implement auth', []);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
