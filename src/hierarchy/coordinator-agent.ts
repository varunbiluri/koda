import type { Agent, AgentInput, AgentOutput, AgentCategory, Task } from '../agents/types.js';
import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { agentRegistry } from '../orchestrator/agent-registry.js';
import { AgentWaveScheduler } from '../orchestrator/agent-wave-scheduler.js';

export type CoordinatorType =
  | 'planning-coordinator'
  | 'coding-coordinator'
  | 'testing-coordinator'
  | 'debugging-coordinator'
  | 'review-coordinator'
  | 'optimization-coordinator'
  | 'infrastructure-coordinator';

export interface CoordinationPlan {
  agents: Agent[];
  tasks: Task[];
  executionWaves: Task[][];
  strategy: string;
}

/**
 * Base Coordinator Agent - Manages a group of agents within a category
 *
 * Coordinators sit between the Supervisor and individual agents,
 * managing execution within their domain (planning, coding, testing, etc.)
 */
export abstract class CoordinatorAgent implements Agent {
  abstract name: string;
  abstract category: AgentCategory;
  abstract description: string;

  protected scheduler: AgentWaveScheduler;

  constructor() {
    this.scheduler = new AgentWaveScheduler();
  }

  async execute(input: AgentInput, memory: WorkspaceMemory): Promise<AgentOutput> {
    memory.info(`${this.name} starting coordination`, this.name);

    try {
      // Step 1: Select agents for this phase
      const agents = this.selectAgents(input.task, memory);
      memory.info(`Selected ${agents.length} agents: ${agents.map((a) => a.name).join(', ')}`, this.name);

      // Step 2: Create tasks for selected agents
      const tasks = this.createTasks(input.task, agents, memory);

      // Step 3: Organize into execution waves
      const waves = this.organizeWaves(tasks);
      memory.info(`Organized into ${waves.length} execution waves`, this.name);

      // Step 4: Execute waves
      const outputs = await this.executeWaves(waves, memory);

      // Step 5: Synthesize results
      const result = this.synthesizeResults(outputs, memory);

      memory.info(`${this.name} completed coordination`, this.name);

      return {
        agentName: this.name,
        success: true,
        result,
        suggestions: this.generateSuggestions(outputs),
        nextSteps: this.generateNextSteps(outputs),
      };
    } catch (error) {
      memory.error(`${this.name} coordination failed: ${(error as Error).message}`, this.name);
      return {
        agentName: this.name,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Select appropriate agents for the task
   */
  protected abstract selectAgents(task: string, memory: WorkspaceMemory): Agent[];

  /**
   * Create tasks for selected agents
   */
  protected abstract createTasks(
    userTask: string,
    agents: Agent[],
    memory: WorkspaceMemory,
  ): Task[];

  /**
   * Organize tasks into execution waves
   */
  protected organizeWaves(tasks: Task[]): Task[][] {
    const waves: Task[][] = [];
    const completed = new Set<string>();
    let remaining = [...tasks];

    while (remaining.length > 0) {
      const ready = remaining.filter((task) =>
        task.dependencies.every((dep) => completed.has(dep)),
      );

      if (ready.length === 0) {
        // Take highest priority task to break deadlock
        const next = remaining.sort((a, b) => b.priority - a.priority)[0];
        if (next) {
          ready.push(next);
        } else {
          break;
        }
      }

      waves.push(ready);
      ready.forEach((t) => completed.add(t.id));
      remaining = remaining.filter((t) => !completed.has(t.id));
    }

    return waves;
  }

  /**
   * Execute waves of tasks
   */
  protected async executeWaves(
    waves: Task[][],
    memory: WorkspaceMemory,
  ): Promise<AgentOutput[]> {
    const allOutputs: AgentOutput[] = [];

    for (let i = 0; i < waves.length; i++) {
      memory.info(`Executing wave ${i + 1}/${waves.length}`, this.name);

      const waveOutputs = await this.scheduler.executeWave(waves[i], memory);

      allOutputs.push(...Array.from(waveOutputs.values()));
    }

    return allOutputs;
  }

  /**
   * Synthesize results from agent outputs
   */
  protected abstract synthesizeResults(outputs: AgentOutput[], memory: WorkspaceMemory): unknown;

  /**
   * Generate suggestions based on outputs
   */
  protected generateSuggestions(outputs: AgentOutput[]): string[] {
    const suggestions: string[] = [];

    const successful = outputs.filter((o) => o.success).length;
    const failed = outputs.filter((o) => !o.success).length;

    suggestions.push(`Completed ${successful}/${outputs.length} tasks successfully`);

    if (failed > 0) {
      suggestions.push(`${failed} tasks failed - review errors and retry`);
    }

    // Collect unique suggestions from outputs
    const uniqueSuggestions = new Set<string>();
    for (const output of outputs) {
      if (output.suggestions) {
        output.suggestions.forEach((s) => uniqueSuggestions.add(s));
      }
    }

    suggestions.push(...Array.from(uniqueSuggestions).slice(0, 3));

    return suggestions;
  }

  /**
   * Generate next steps based on outputs
   */
  protected generateNextSteps(outputs: AgentOutput[]): string[] {
    const nextSteps: string[] = [];

    // Collect unique next steps from outputs
    const uniqueSteps = new Set<string>();
    for (const output of outputs) {
      if (output.nextSteps) {
        output.nextSteps.forEach((s) => uniqueSteps.add(s));
      }
    }

    nextSteps.push(...Array.from(uniqueSteps).slice(0, 5));

    return nextSteps;
  }
}

/**
 * Planning Coordinator - Manages planning phase agents
 */
export class PlanningCoordinator extends CoordinatorAgent {
  name = 'planning-coordinator';
  category = 'planning' as const;
  description = 'Coordinates architecture, task breakdown, and repository analysis agents';

  protected selectAgents(task: string, memory: WorkspaceMemory): Agent[] {
    const planningAgents = agentRegistry.getAgentsByCategory('planning');

    // Always include core planning agents
    const coreAgents = ['architecture-agent', 'task-breakdown-agent', 'repo-analysis-agent'];

    return planningAgents.filter((agent) => coreAgents.includes(agent.name));
  }

  protected createTasks(userTask: string, agents: Agent[], memory: WorkspaceMemory): Task[] {
    return agents.map((agent, index) => ({
      id: `planning-${index}`,
      description: `${agent.name}: ${userTask}`,
      type: 'planning',
      priority: 10 - index,
      dependencies: [],
      status: 'pending' as const,
      assignedAgent: agent.name,
    }));
  }

  protected synthesizeResults(outputs: AgentOutput[], memory: WorkspaceMemory): unknown {
    const planningResults = {
      architecture: outputs.find((o) => o.agentName === 'architecture-agent')?.result,
      taskBreakdown: outputs.find((o) => o.agentName === 'task-breakdown-agent')?.result,
      repoAnalysis: outputs.find((o) => o.agentName === 'repo-analysis-agent')?.result,
    };

    memory.setContext('planningResults', planningResults);

    return planningResults;
  }
}

/**
 * Coding Coordinator - Manages implementation agents
 */
export class CodingCoordinator extends CoordinatorAgent {
  name = 'coding-coordinator';
  category = 'coding' as const;
  description = 'Coordinates backend, frontend, API, and database implementation agents';

  protected selectAgents(task: string, memory: WorkspaceMemory): Agent[] {
    const codingAgents = agentRegistry.getAgentsByCategory('coding');

    // Select based on task keywords
    const taskLower = task.toLowerCase();
    const selected: Agent[] = [];

    for (const agent of codingAgents) {
      if (
        taskLower.includes('backend') ||
        taskLower.includes('api') ||
        taskLower.includes('server')
      ) {
        if (agent.name === 'backend-agent') selected.push(agent);
      }
    }

    // Default to backend agent if nothing specific
    if (selected.length === 0 && codingAgents.length > 0) {
      selected.push(codingAgents[0]);
    }

    return selected;
  }

  protected createTasks(userTask: string, agents: Agent[], memory: WorkspaceMemory): Task[] {
    return agents.map((agent, index) => ({
      id: `coding-${index}`,
      description: `${agent.name}: ${userTask}`,
      type: 'coding',
      priority: 8 - index,
      dependencies: [], // Set by planning phase
      status: 'pending' as const,
      assignedAgent: agent.name,
    }));
  }

  protected synthesizeResults(outputs: AgentOutput[], memory: WorkspaceMemory): unknown {
    const filesModified = new Set<string>();
    const toolsUsed = new Set<string>();

    for (const output of outputs) {
      if (output.filesModified) {
        output.filesModified.forEach((f) => filesModified.add(f));
      }
      if (output.toolsUsed) {
        output.toolsUsed.forEach((t) => toolsUsed.add(t));
      }
    }

    const codingResults = {
      filesModified: Array.from(filesModified),
      toolsUsed: Array.from(toolsUsed),
      agentOutputs: outputs,
    };

    memory.setContext('codingResults', codingResults);

    return codingResults;
  }
}

/**
 * Testing Coordinator - Manages testing and verification agents
 */
export class TestingCoordinator extends CoordinatorAgent {
  name = 'testing-coordinator';
  category = 'testing' as const;
  description = 'Coordinates unit tests, integration tests, build, and lint verification';

  protected selectAgents(task: string, memory: WorkspaceMemory): Agent[] {
    const testingAgents = agentRegistry.getAgentsByCategory('testing');

    // Select comprehensive verification for now
    return testingAgents.filter((agent) =>
      ['comprehensive-verification-agent', 'unit-test-agent'].includes(agent.name),
    );
  }

  protected createTasks(userTask: string, agents: Agent[], memory: WorkspaceMemory): Task[] {
    return agents.map((agent, index) => ({
      id: `testing-${index}`,
      description: `${agent.name}: verify implementation`,
      type: 'testing',
      priority: 6 - index,
      dependencies: [], // Set by coding phase
      status: 'pending' as const,
      assignedAgent: agent.name,
    }));
  }

  protected synthesizeResults(outputs: AgentOutput[], memory: WorkspaceMemory): unknown {
    const allPassed = outputs.every((o) => o.success);

    const testingResults = {
      allPassed,
      results: outputs.map((o) => ({
        agent: o.agentName,
        success: o.success,
        error: o.error,
      })),
    };

    memory.setContext('testingResults', testingResults);

    return testingResults;
  }
}

/**
 * Debugging Coordinator - Manages debugging agents
 */
export class DebuggingCoordinator extends CoordinatorAgent {
  name = 'debugging-coordinator';
  category = 'debugging' as const;
  description = 'Coordinates issue diagnosis and debugging agents';

  protected selectAgents(task: string, memory: WorkspaceMemory): Agent[] {
    return agentRegistry.getAgentsByCategory('debugging');
  }

  protected createTasks(userTask: string, agents: Agent[], memory: WorkspaceMemory): Task[] {
    return agents.map((agent, index) => ({
      id: `debugging-${index}`,
      description: `${agent.name}: ${userTask}`,
      type: 'debugging',
      priority: 8 - index,
      dependencies: [],
      status: 'pending' as const,
      assignedAgent: agent.name,
    }));
  }

  protected synthesizeResults(outputs: AgentOutput[], memory: WorkspaceMemory): unknown {
    return { debuggingOutputs: outputs };
  }
}

/**
 * Review Coordinator - Manages code review agents
 */
export class ReviewCoordinator extends CoordinatorAgent {
  name = 'review-coordinator';
  category = 'review' as const;
  description = 'Coordinates code review, security audit, and quality assessment agents';

  protected selectAgents(task: string, memory: WorkspaceMemory): Agent[] {
    return agentRegistry.getAgentsByCategory('review');
  }

  protected createTasks(userTask: string, agents: Agent[], memory: WorkspaceMemory): Task[] {
    return agents.map((agent, index) => ({
      id: `review-${index}`,
      description: `${agent.name}: review implementation`,
      type: 'review',
      priority: 4 - index,
      dependencies: [],
      status: 'pending' as const,
      assignedAgent: agent.name,
    }));
  }

  protected synthesizeResults(outputs: AgentOutput[], memory: WorkspaceMemory): unknown {
    const allSuggestions = outputs.flatMap((o) => o.suggestions || []);

    return {
      reviewComplete: true,
      suggestions: allSuggestions,
      outputs,
    };
  }
}

// Export all coordinators
export const coordinators = {
  planning: new PlanningCoordinator(),
  coding: new CodingCoordinator(),
  testing: new TestingCoordinator(),
  debugging: new DebuggingCoordinator(),
  review: new ReviewCoordinator(),
};
