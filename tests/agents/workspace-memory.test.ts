import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceMemory } from '../../src/memory/workspace-memory.js';
import type { AgentOutput } from '../../src/agents/types.js';

describe('WorkspaceMemory', () => {
  let memory: WorkspaceMemory;

  beforeEach(() => {
    memory = new WorkspaceMemory('/test/path', 'Test task');
  });

  it('initializes with root path and user task', () => {
    expect(memory.rootPath).toBe('/test/path');
    expect(memory.userTask).toBe('Test task');
  });

  it('stores and retrieves context', () => {
    memory.setContext('key1', 'value1');
    memory.setContext('key2', { nested: 'object' });

    expect(memory.getContext('key1')).toBe('value1');
    expect(memory.getContext('key2')).toEqual({ nested: 'object' });
    expect(memory.getContext('nonexistent')).toBeUndefined();
  });

  it('records and retrieves agent outputs', () => {
    const output1: AgentOutput = {
      agentName: 'test-agent-1',
      success: true,
      result: 'done',
    };

    const output2: AgentOutput = {
      agentName: 'test-agent-2',
      success: false,
      error: 'failed',
    };

    memory.recordAgentOutput(output1);
    memory.recordAgentOutput(output2);

    expect(memory.getAgentOutput('test-agent-1')).toEqual(output1);
    expect(memory.getAgentOutput('test-agent-2')).toEqual(output2);
    expect(memory.getAllAgentOutputs()).toHaveLength(2);
  });

  it('filters successful and failed outputs', () => {
    memory.recordAgentOutput({ agentName: 'a1', success: true });
    memory.recordAgentOutput({ agentName: 'a2', success: false, error: 'err' });
    memory.recordAgentOutput({ agentName: 'a3', success: true });

    expect(memory.getSuccessfulOutputs()).toHaveLength(2);
    expect(memory.getFailedOutputs()).toHaveLength(1);
  });

  it('logs execution events', () => {
    memory.info('Info message', 'agent1');
    memory.warn('Warning message', 'agent2');
    memory.error('Error message', 'agent3');

    const logs = memory.getExecutionLogs();
    expect(logs).toHaveLength(3);
    expect(logs[0].level).toBe('info');
    expect(logs[1].level).toBe('warn');
    expect(logs[2].level).toBe('error');
  });

  it('generates summary', () => {
    memory.recordAgentOutput({ agentName: 'a1', success: true });
    memory.recordAgentOutput({ agentName: 'a2', success: false, error: 'err' });
    memory.error('Test error');
    memory.warn('Test warning');

    const summary = memory.getSummary();

    expect(summary.totalAgents).toBe(2);
    expect(summary.successfulAgents).toBe(1);
    expect(summary.failedAgents).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.warnings).toBe(1);
  });

  it('clears all data', () => {
    memory.setContext('key', 'value');
    memory.recordAgentOutput({ agentName: 'test', success: true });
    memory.info('Test log');

    memory.clear();

    expect(memory.getAllContext()).toEqual({});
    expect(memory.getAllAgentOutputs()).toHaveLength(0);
    expect(memory.getExecutionLogs()).toHaveLength(0);
  });
});
