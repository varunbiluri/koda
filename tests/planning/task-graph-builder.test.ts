/**
 * Tests for TaskGraphBuilder.
 *
 * LLM calls are mocked — deterministic, fast, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskGraphBuilder } from '../../src/planning/task-graph-builder.js';
import { ExecutionGraph } from '../../src/execution/execution-graph.js';
import type { AIProvider } from '../../src/ai/types.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockProvider(planText: string): AIProvider {
  return {
    sendChatCompletion: vi.fn().mockResolvedValue({
      choices: [{ message: { content: planText } }],
    }),
  } as unknown as AIProvider;
}

const VALID_GRAPH_TEXT = [
  'NODE explore_repo    | type=explore    | agent=ExplorerAgent     | deps=               | priority=10 | desc=Explore the repository',
  'NODE analyze_deps    | type=analyze    | agent=AnalysisAgent     | deps=explore_repo   | priority=9  | desc=Analyze dependencies',
  'NODE implement_auth  | type=implement  | agent=CodingAgent       | deps=analyze_deps   | priority=8  | desc=Implement JWT auth',
  'NODE update_config   | type=implement  | agent=CodingAgent       | deps=analyze_deps   | priority=8  | desc=Update environment config',
  'NODE run_tests       | type=test       | agent=TestAgent         | deps=implement_auth,update_config | priority=7 | desc=Run all tests',
  'NODE verify          | type=verify     | agent=VerificationAgent | deps=run_tests      | priority=6  | desc=Build + type check',
].join('\n');

// ── Tests: build() ────────────────────────────────────────────────────────────

describe('TaskGraphBuilder.build()', () => {
  let builder: TaskGraphBuilder;

  beforeEach(() => {
    builder = new TaskGraphBuilder(makeMockProvider(VALID_GRAPH_TEXT));
  });

  it('returns an ExecutionGraph', async () => {
    const graph = await builder.build('Add JWT auth');
    expect(graph).toBeInstanceOf(ExecutionGraph);
  });

  it('parses correct number of nodes', async () => {
    const graph = await builder.build('Add JWT auth');
    expect(graph.getAllNodes()).toHaveLength(6);
  });

  it('sets correct node ids', async () => {
    const graph = await builder.build('Add JWT auth');
    const ids   = graph.getAllNodes().map((n) => n.id);
    expect(ids).toContain('explore_repo');
    expect(ids).toContain('implement_auth');
    expect(ids).toContain('verify');
  });

  it('parses node types correctly', async () => {
    const graph = await builder.build('Add JWT auth');
    expect(graph.getNode('explore_repo')?.type).toBe('explore');
    expect(graph.getNode('run_tests')?.type).toBe('test');
    expect(graph.getNode('verify')?.type).toBe('verify');
  });

  it('parses agent roles correctly', async () => {
    const graph = await builder.build('Add JWT auth');
    expect(graph.getNode('explore_repo')?.agentRole).toBe('ExplorerAgent');
    expect(graph.getNode('implement_auth')?.agentRole).toBe('CodingAgent');
    expect(graph.getNode('run_tests')?.agentRole).toBe('TestAgent');
    expect(graph.getNode('verify')?.agentRole).toBe('VerificationAgent');
  });

  it('parses dependencies correctly', async () => {
    const graph = await builder.build('Add JWT auth');
    expect(graph.getNode('analyze_deps')?.dependsOn).toEqual(['explore_repo']);
    expect(graph.getNode('run_tests')?.dependsOn).toContain('implement_auth');
    expect(graph.getNode('run_tests')?.dependsOn).toContain('update_config');
  });

  it('parses priority values', async () => {
    const graph = await builder.build('Add JWT auth');
    expect(graph.getNode('explore_repo')?.priority).toBe(10);
    expect(graph.getNode('verify')?.priority).toBe(6);
  });

  it('sets all nodes to pending state', async () => {
    const graph = await builder.build('Add JWT auth');
    for (const node of graph.getAllNodes()) {
      expect(node.state).toBe('pending');
    }
  });

  it('populates node description from desc field', async () => {
    const graph = await builder.build('Add JWT auth');
    expect(graph.getNode('implement_auth')?.description).toBe('Implement JWT auth');
  });

  it('sets context.task from description', async () => {
    const graph = await builder.build('Add JWT auth');
    expect(graph.getNode('explore_repo')?.context.task).toBe('Explore the repository');
  });

  it('explore nodes get fewer maxRounds than implement nodes', async () => {
    const graph   = await builder.build('Add JWT auth');
    const explore = graph.getNode('explore_repo')!;
    const impl    = graph.getNode('implement_auth')!;
    expect(explore.context.maxRounds!).toBeLessThan(impl.context.maxRounds!);
  });

  it('verify nodes have maxRetries=1', async () => {
    const graph = await builder.build('Add JWT auth');
    expect(graph.getNode('verify')?.maxRetries).toBe(1);
  });

  it('uses provided repoContext in node contexts', async () => {
    const graph = await builder.build('Add JWT auth', 'src/ contains TypeScript');
    for (const node of graph.getAllNodes()) {
      expect(node.context.repoContext).toBe('src/ contains TypeScript');
    }
  });
});

describe('TaskGraphBuilder.build() — LLM failure fallback', () => {
  it('returns a default 4-node graph when LLM throws', async () => {
    const failProvider: AIProvider = {
      sendChatCompletion: vi.fn().mockRejectedValue(new Error('API error')),
    } as unknown as AIProvider;
    const builder = new TaskGraphBuilder(failProvider);
    const graph   = await builder.build('Some task');
    expect(graph.getAllNodes().length).toBeGreaterThanOrEqual(4);
  });

  it('returns a default graph when LLM returns empty string', async () => {
    const builder = new TaskGraphBuilder(makeMockProvider(''));
    const graph   = await builder.build('Some task');
    expect(graph.getAllNodes().length).toBeGreaterThanOrEqual(4);
  });

  it('default fallback graph has root node with no deps', async () => {
    const builder = new TaskGraphBuilder(makeMockProvider(''));
    const graph   = await builder.build('Some task');
    const roots   = graph.getAllNodes().filter((n) => n.dependsOn.length === 0);
    expect(roots.length).toBeGreaterThanOrEqual(1);
  });
});

describe('TaskGraphBuilder.build() — validation', () => {
  it('ignores lines without NODE prefix', async () => {
    const text = [
      'This is a plan:',
      'NODE explore | type=explore | agent=ExplorerAgent | deps= | priority=10 | desc=Explore',
      'Note: always start with exploration',
    ].join('\n');
    const builder = new TaskGraphBuilder(makeMockProvider(text));
    const graph   = await builder.build('Task');
    expect(graph.getAllNodes()).toHaveLength(1);
  });

  it('removes unknown dep references silently', async () => {
    const text = 'NODE impl | type=implement | agent=CodingAgent | deps=nonexistent | priority=5 | desc=Implement';
    const builder = new TaskGraphBuilder(makeMockProvider(text));
    const graph   = await builder.build('Task');
    expect(graph.getNode('impl')?.dependsOn).toHaveLength(0);
  });

  it('falls back when a cycle is detected', async () => {
    const cycleText = [
      'NODE a | type=implement | agent=CodingAgent | deps=b | priority=5 | desc=Node A',
      'NODE b | type=implement | agent=CodingAgent | deps=a | priority=5 | desc=Node B',
    ].join('\n');
    const builder = new TaskGraphBuilder(makeMockProvider(cycleText));
    const graph   = await builder.build('Task');
    // Falls back to default graph (no cycles)
    expect(graph.getAllNodes().length).toBeGreaterThanOrEqual(4);
  });

  it('deduplicates node ids', async () => {
    const dupeText = [
      'NODE a | type=explore | agent=ExplorerAgent | deps= | priority=5 | desc=First',
      'NODE a | type=explore | agent=ExplorerAgent | deps= | priority=5 | desc=Duplicate',
    ].join('\n');
    const builder = new TaskGraphBuilder(makeMockProvider(dupeText));
    const graph   = await builder.build('Task');
    expect(graph.getAllNodes().filter((n) => n.id === 'a')).toHaveLength(1);
  });

  it('caps at MAX_NODES (12)', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      `NODE node_${i} | type=implement | agent=CodingAgent | deps= | priority=5 | desc=Node ${i}`,
    ).join('\n');
    const builder = new TaskGraphBuilder(makeMockProvider(many));
    const graph   = await builder.build('Task');
    expect(graph.getAllNodes().length).toBeLessThanOrEqual(12);
  });
});

describe('TaskGraphBuilder.buildFromNodes()', () => {
  it('builds a graph from manually specified nodes', () => {
    const builder = new TaskGraphBuilder(makeMockProvider(''));
    const nodes = [
      {
        id: 'a', type: 'explore' as const, agentRole: 'ExplorerAgent' as const,
        description: 'Explore', dependsOn: [], state: 'pending' as const,
        context: { task: 'Explore' }, retryCount: 0, maxRetries: 2, priority: 5,
      },
      {
        id: 'b', type: 'implement' as const, agentRole: 'CodingAgent' as const,
        description: 'Implement', dependsOn: ['a'], state: 'pending' as const,
        context: { task: 'Implement' }, retryCount: 0, maxRetries: 2, priority: 4,
      },
    ];
    const graph = builder.buildFromNodes('Manual task', nodes);
    expect(graph.getAllNodes()).toHaveLength(2);
    expect(graph.getNode('b')?.dependsOn).toEqual(['a']);
  });

  it('throws when a cycle is provided', () => {
    const builder = new TaskGraphBuilder(makeMockProvider(''));
    const nodes = [
      {
        id: 'a', type: 'implement' as const, agentRole: 'CodingAgent' as const,
        description: 'A', dependsOn: ['b'], state: 'pending' as const,
        context: { task: 'A' }, retryCount: 0, maxRetries: 2, priority: 5,
      },
      {
        id: 'b', type: 'implement' as const, agentRole: 'CodingAgent' as const,
        description: 'B', dependsOn: ['a'], state: 'pending' as const,
        context: { task: 'B' }, retryCount: 0, maxRetries: 2, priority: 5,
      },
    ];
    expect(() => builder.buildFromNodes('Cycle task', nodes)).toThrow(/Cycle/);
  });
});
