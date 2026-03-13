import { describe, it, expect } from 'vitest';
import { ArchitectureAgent } from '../../src/agents/planning/architecture-agent.js';
import { WorkspaceMemory } from '../../src/memory/workspace-memory.js';

describe('ArchitectureAgent', () => {
  it('executes architecture analysis', async () => {
    const agent = new ArchitectureAgent();
    const memory = new WorkspaceMemory('/test', 'Add authentication');

    const result = await agent.execute(
      { task: 'Add JWT authentication' },
      memory,
    );

    expect(result.agentName).toBe('architecture-agent');
    expect(result.success).toBeDefined();

    // Agent returns a result
    if (result.success) {
      expect(result.result).toBeDefined();
    }
  });

  it('has correct metadata', () => {
    const agent = new ArchitectureAgent();

    expect(agent.name).toBe('architecture-agent');
    expect(agent.category).toBe('planning');
    expect(agent.description).toBeTruthy();
  });
});
