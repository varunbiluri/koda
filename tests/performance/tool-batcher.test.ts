/**
 * ToolBatcher — unit tests
 */

import { describe, it, expect, vi } from 'vitest';
import { ToolBatcher } from '../../src/performance/tool-batcher.js';
import type { ToolExecutor } from '../../src/performance/tool-batcher.js';

function makeExecutor(delay = 0): ToolExecutor {
  return async (tool, args) => {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    return `result:${tool}:${JSON.stringify(args)}`;
  };
}

describe('ToolBatcher.run', () => {
  it('returns results in original order', async () => {
    const batcher  = new ToolBatcher();
    const executor = makeExecutor();
    const results  = await batcher.run([
      { tool: 'read_file',  args: { path: 'a.ts' } },
      { tool: 'read_file',  args: { path: 'b.ts' } },
      { tool: 'grep_code',  args: { pattern: 'TODO' } },
    ], executor);

    expect(results).toHaveLength(3);
    expect(results[0].args.path).toBe('a.ts');
    expect(results[1].args.path).toBe('b.ts');
    expect(results[2].args.pattern).toBe('TODO');
  });

  it('handles stateful tools sequentially', async () => {
    const callOrder: string[] = [];
    const executor: ToolExecutor = async (tool, args) => {
      callOrder.push(tool + ':' + (args.path ?? args.cmd ?? ''));
      return 'ok';
    };

    const batcher = new ToolBatcher();
    await batcher.run([
      { tool: 'write_file',  args: { path: 'out.ts' } },
      { tool: 'run_terminal', args: { cmd: 'pnpm test' } },
    ], executor);

    expect(callOrder).toEqual(['write_file:out.ts', 'run_terminal:pnpm test']);
  });

  it('mixes batchable and stateful tools correctly', async () => {
    const executor = makeExecutor();
    const batcher  = new ToolBatcher({ maxParallel: 4 });
    const results  = await batcher.run([
      { tool: 'read_file',   args: { path: 'a.ts' } },
      { tool: 'write_file',  args: { path: 'b.ts' } }, // stateful — breaks batch
      { tool: 'grep_code',   args: { pattern: 'X'  } },
    ], executor);

    expect(results).toHaveLength(3);
    expect(results[0].tool).toBe('read_file');
    expect(results[1].tool).toBe('write_file');
    expect(results[2].tool).toBe('grep_code');
  });

  it('respects maxParallel limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const executor: ToolExecutor = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return 'ok';
    };

    const batcher = new ToolBatcher({ maxParallel: 3 });
    const calls = Array.from({ length: 9 }, (_, i) => ({
      tool: 'read_file',
      args: { path: `file${i}.ts` },
    }));
    await batcher.run(calls, executor);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('getStats() tracks batchedCalls', async () => {
    const batcher  = new ToolBatcher();
    const executor = makeExecutor();
    await batcher.run([
      { tool: 'read_file', args: { path: 'a.ts' } },
      { tool: 'read_file', args: { path: 'b.ts' } },
    ], executor);
    expect(batcher.getStats().batchedCalls).toBe(2);
  });
});
