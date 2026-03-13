import { describe, it, expect } from 'vitest';
import { TaskDecomposer } from '../../src/orchestrator/task-decomposer.js';
import { WorkspaceMemory } from '../../src/memory/workspace-memory.js';

describe('TaskDecomposer', () => {
  it('decomposes task into execution plan', async () => {
    const decomposer = new TaskDecomposer();
    const memory = new WorkspaceMemory('/test', 'Add authentication');

    const plan = await decomposer.decompose('Add authentication', memory);

    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.waves.length).toBeGreaterThan(0);
    expect(plan.estimatedDuration).toBeGreaterThan(0);
  });

  it('organizes tasks into waves based on dependencies', async () => {
    const decomposer = new TaskDecomposer();
    const memory = new WorkspaceMemory('/test', 'Build feature');

    const plan = await decomposer.decompose('Build feature', memory);

    // Each wave should only contain tasks whose dependencies are in previous waves
    for (let i = 0; i < plan.waves.length; i++) {
      const wave = plan.waves[i];
      const previousTaskIds = plan.waves
        .slice(0, i)
        .flat()
        .map((t) => t.id);

      for (const task of wave) {
        for (const dep of task.dependencies) {
          expect(previousTaskIds).toContain(dep);
        }
      }
    }
  });

  it('assigns priorities to tasks', async () => {
    const decomposer = new TaskDecomposer();
    const memory = new WorkspaceMemory('/test', 'Implement feature');

    const plan = await decomposer.decompose('Implement feature', memory);

    for (const task of plan.tasks) {
      expect(task.priority).toBeGreaterThan(0);
      expect(task.priority).toBeLessThanOrEqual(10);
    }
  });

  it('sets task types correctly', async () => {
    const decomposer = new TaskDecomposer();
    const memory = new WorkspaceMemory('/test', 'Add tests');

    const plan = await decomposer.decompose('Add tests', memory);

    const validTypes = ['planning', 'coding', 'testing', 'debugging', 'review', 'optimization', 'infrastructure'];

    for (const task of plan.tasks) {
      expect(validTypes).toContain(task.type);
    }
  });
});
