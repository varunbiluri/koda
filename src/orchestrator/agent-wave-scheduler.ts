import type { Agent, Task, AgentInput, AgentOutput } from '../agents/types.js';
import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { agentRegistry } from './agent-registry.js';

export class AgentWaveScheduler {
  async executeWave(
    wave: Task[],
    memory: WorkspaceMemory,
  ): Promise<Map<string, AgentOutput>> {
    const results = new Map<string, AgentOutput>();

    // Execute all tasks in wave concurrently
    const promises = wave.map(async (task) => {
      const agent = this.selectAgentForTask(task);
      if (!agent) {
        const output: AgentOutput = {
          agentName: 'unknown',
          success: false,
          error: `No suitable agent found for task: ${task.description}`,
        };
        results.set(task.id, output);
        return;
      }

      task.assignedAgent = agent.name;
      task.status = 'in_progress';

      const input: AgentInput = {
        task: task.description,
        context: { taskId: task.id, taskType: task.type },
      };

      try {
        const output = await agent.execute(input, memory);
        task.status = output.success ? 'completed' : 'failed';
        task.output = output;

        memory.recordAgentOutput(output);
        results.set(task.id, output);

        if (output.success) {
          memory.info(`Task completed: ${task.description}`, agent.name);
        } else {
          memory.error(`Task failed: ${task.description} - ${output.error}`, agent.name);
        }
      } catch (err) {
        const output: AgentOutput = {
          agentName: agent.name,
          success: false,
          error: (err as Error).message,
        };

        task.status = 'failed';
        task.output = output;

        memory.recordAgentOutput(output);
        memory.error(`Task error: ${(err as Error).message}`, agent.name);
        results.set(task.id, output);
      }
    });

    await Promise.all(promises);
    return results;
  }

  private selectAgentForTask(task: Task): Agent | undefined {
    // Try to match task type to agent category
    const agents = agentRegistry.getAgentsByCategory(task.type as any);

    if (agents.length > 0) {
      // For now, return the first matching agent
      // In a more sophisticated system, we could score agents based on task description
      return agents[0];
    }

    // Fallback: try to find any agent that might handle this
    const allAgents = agentRegistry.getAllAgents();
    return allAgents.find((agent) =>
      this.agentMatchesTask(agent, task)
    );
  }

  private agentMatchesTask(agent: Agent, task: Task): boolean {
    const taskLower = task.description.toLowerCase();
    const agentLower = agent.description.toLowerCase();

    // Simple keyword matching
    const keywords = taskLower.split(' ').filter((w) => w.length > 3);
    return keywords.some((keyword) => agentLower.includes(keyword));
  }
}
