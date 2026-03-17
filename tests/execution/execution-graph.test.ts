/**
 * Tests for ExecutionGraph — node management, state machine, dependency resolution.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ExecutionGraph,
  type ExecutionNode,
  type NodeResult,
} from '../../src/execution/execution-graph.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeNode(id: string, deps: string[] = [], priority = 5): ExecutionNode {
  return {
    id,
    type:        'implement',
    agentRole:   'CodingAgent',
    description: `Task for ${id}`,
    dependsOn:   deps,
    state:       'pending',
    context:     { task: `Task for ${id}` },
    retryCount:  0,
    maxRetries:  2,
    priority,
  };
}

const RESULT: NodeResult = {
  output:        'done',
  filesModified: ['src/auth.ts'],
  toolCallCount: 3,
  durationMs:    500,
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ExecutionGraph construction', () => {
  it('assigns a unique graphId and createdAt', () => {
    const g = new ExecutionGraph('test task');
    expect(g.graphId).toMatch(/^graph-/);
    expect(g.createdAt).toBeGreaterThan(0);
    expect(g.task).toBe('test task');
  });

  it('accepts a custom graphId', () => {
    const g = new ExecutionGraph('task', 'my-graph-id');
    expect(g.graphId).toBe('my-graph-id');
  });

  it('throws on duplicate node id', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    expect(() => g.addNode(makeNode('a'))).toThrow(/Duplicate node id/);
  });

  it('getAllNodes returns all added nodes', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    g.addNode(makeNode('b', ['a']));
    expect(g.getAllNodes()).toHaveLength(2);
  });
});

describe('ExecutionGraph.getRunnableNodes()', () => {
  it('returns root nodes (no deps) immediately', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('root1'));
    g.addNode(makeNode('root2'));
    g.addNode(makeNode('child', ['root1']));
    const runnable = g.getRunnableNodes();
    expect(runnable.map((n) => n.id)).toContain('root1');
    expect(runnable.map((n) => n.id)).toContain('root2');
    expect(runnable.map((n) => n.id)).not.toContain('child');
  });

  it('returns dependent node after dep completes', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    g.addNode(makeNode('b', ['a']));
    g.markRunning('a');
    g.markCompleted('a', RESULT);
    const runnable = g.getRunnableNodes();
    expect(runnable.map((n) => n.id)).toContain('b');
  });

  it('sorts by descending priority', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('low',  [], 2));
    g.addNode(makeNode('high', [], 8));
    g.addNode(makeNode('mid',  [], 5));
    const runnable = g.getRunnableNodes();
    expect(runnable[0].id).toBe('high');
    expect(runnable[1].id).toBe('mid');
    expect(runnable[2].id).toBe('low');
  });

  it('excludes running and completed nodes', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    g.markRunning('a');
    expect(g.getRunnableNodes().map((n) => n.id)).not.toContain('a');
  });

  it('includes retrying nodes', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    g.markRunning('a');
    g.markFailed('a', 'error');  // retryCount=0 < maxRetries=2 → retrying
    expect(g.getRunnableNodes().map((n) => n.id)).toContain('a');
  });
});

describe('ExecutionGraph state transitions', () => {
  let g: ExecutionGraph;

  beforeEach(() => {
    g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
  });

  it('markRunning sets state and startedAt', () => {
    g.markRunning('a');
    const node = g.getNode('a')!;
    expect(node.state).toBe('running');
    expect(node.startedAt).toBeGreaterThan(0);
  });

  it('markCompleted sets state, result, completedAt', () => {
    g.markRunning('a');
    g.markCompleted('a', RESULT);
    const node = g.getNode('a')!;
    expect(node.state).toBe('completed');
    expect(node.result?.output).toBe('done');
    expect(node.completedAt).toBeGreaterThan(0);
  });

  it('markFailed transitions to retrying when retries remain', () => {
    g.markRunning('a');
    g.markFailed('a', 'first error');
    const node = g.getNode('a')!;
    expect(node.state).toBe('retrying');
    expect(node.retryCount).toBe(1);
    expect(node.error).toBe('first error');
  });

  it('markFailed transitions to failed when retries exhausted', () => {
    g.addNode(makeNode('b'));
    const b = g.getNode('b')!;
    b.maxRetries = 0;
    g.markRunning('b');
    g.markFailed('b', 'fatal');
    expect(g.getNode('b')!.state).toBe('failed');
  });

  it('throws when marking unknown node', () => {
    expect(() => g.markRunning('nope')).toThrow(/Node not found/);
  });
});

describe('ExecutionGraph.isComplete() and hasFailures()', () => {
  it('isComplete is false while pending nodes exist', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    expect(g.isComplete()).toBe(false);
  });

  it('isComplete is true when all nodes reach terminal state', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    g.markRunning('a');
    g.markCompleted('a', RESULT);
    expect(g.isComplete()).toBe(true);
  });

  it('skipped nodes count as terminal', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    g.markSkipped('a');
    expect(g.isComplete()).toBe(true);
  });

  it('hasFailures returns false when no failures', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    g.markRunning('a');
    g.markCompleted('a', RESULT);
    expect(g.hasFailures()).toBe(false);
  });

  it('hasFailures returns true when a node fails terminally', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    const n = g.getNode('a')!;
    n.maxRetries = 0;
    g.markRunning('a');
    g.markFailed('a', 'fatal error');
    expect(g.hasFailures()).toBe(true);
  });
});

describe('ExecutionGraph.getStats()', () => {
  it('counts states correctly', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    g.addNode(makeNode('b'));
    g.addNode(makeNode('c'));
    g.markRunning('a');
    g.markCompleted('a', RESULT);
    g.markRunning('b');
    const stats = g.getStats();
    expect(stats.total).toBe(3);
    expect(stats.completed).toBe(1);
    expect(stats.running).toBe(1);
    expect(stats.pending).toBe(1);
  });
});

describe('ExecutionGraph.insertRecoveryNode()', () => {
  it('inserts recovery node into the graph', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    g.addNode(makeNode('b', ['a']));
    const n = g.getNode('a')!;
    n.maxRetries = 0;
    g.markRunning('a');
    g.markFailed('a', 'error');

    const recovery = makeNode('a_fix', ['a']);
    recovery.isDynamic = true;
    g.insertRecoveryNode('a', recovery);

    expect(g.getNode('a_fix')).toBeDefined();
    expect(g.getNode('a_fix')!.isDynamic).toBe(true);
  });

  it('re-wires pending dependents to the recovery node', () => {
    const g = new ExecutionGraph('task');
    g.addNode(makeNode('a'));
    g.addNode(makeNode('b', ['a']));
    const n = g.getNode('a')!;
    n.maxRetries = 0;
    g.markRunning('a');
    g.markFailed('a', 'error');

    const recovery = makeNode('a_fix');
    g.insertRecoveryNode('a', recovery);

    // b should now depend on a_fix instead of a
    expect(g.getNode('b')!.dependsOn).toContain('a_fix');
    expect(g.getNode('b')!.dependsOn).not.toContain('a');
  });
});

describe('ExecutionGraph serialization', () => {
  it('round-trips through toJSON / fromJSON', () => {
    const g = new ExecutionGraph('serialize test');
    g.addNode(makeNode('a'));
    g.addNode(makeNode('b', ['a']));
    g.markRunning('a');
    g.markCompleted('a', RESULT);

    const json    = g.toJSON();
    const restored = ExecutionGraph.fromJSON(json);

    expect(restored.graphId).toBe(g.graphId);
    expect(restored.task).toBe('serialize test');
    expect(restored.getNode('a')?.state).toBe('completed');
    expect(restored.getNode('b')?.state).toBe('pending');
  });
});
