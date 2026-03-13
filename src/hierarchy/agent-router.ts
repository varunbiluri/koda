import type { Agent, AgentCategory } from '../agents/types.js';
import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { agentRegistry } from '../orchestrator/agent-registry.js';

export interface RoutingDecision {
  agent: Agent;
  confidence: number; // 0-1 score
  reasoning: string;
}

export interface TaskClassification {
  category: AgentCategory;
  keywords: string[];
  confidence: number;
}

/**
 * AgentRouter - Intelligently routes tasks to the most appropriate agents
 *
 * Uses task analysis, keyword matching, and agent capabilities to select
 * the best agents for each task type.
 */
export class AgentRouter {
  private categoryKeywords: Map<AgentCategory, string[]> = new Map([
    [
      'planning',
      [
        'plan', 'design', 'architecture', 'analyze', 'strategy', 'breakdown',
        'decompose', 'requirements', 'specification', 'blueprint',
      ],
    ],
    [
      'coding',
      [
        'implement', 'code', 'create', 'build', 'develop', 'add', 'backend',
        'frontend', 'api', 'database', 'service', 'function', 'class',
        'endpoint', 'route', 'middleware', 'component',
      ],
    ],
    [
      'testing',
      [
        'test', 'verify', 'check', 'validate', 'assert', 'unit', 'integration',
        'e2e', 'coverage', 'spec', 'lint', 'typecheck', 'build',
      ],
    ],
    [
      'debugging',
      [
        'debug', 'fix', 'bug', 'error', 'issue', 'problem', 'crash', 'fail',
        'troubleshoot', 'diagnose', 'investigate', 'trace',
      ],
    ],
    [
      'review',
      [
        'review', 'audit', 'inspect', 'analyze', 'assess', 'evaluate',
        'quality', 'security', 'performance', 'refactor', 'optimize',
      ],
    ],
    [
      'optimization',
      [
        'optimize', 'improve', 'performance', 'speed', 'efficient', 'cache',
        'bundle', 'compress', 'reduce', 'faster', 'memory',
      ],
    ],
    [
      'infrastructure',
      [
        'deploy', 'docker', 'container', 'ci', 'cd', 'pipeline', 'build',
        'infrastructure', 'devops', 'kubernetes', 'cloud',
      ],
    ],
  ]);

  private specificAgentKeywords: Map<string, string[]> = new Map([
    // Planning agents
    ['architecture-agent', ['architecture', 'design', 'structure', 'system']],
    ['task-breakdown-agent', ['breakdown', 'subtask', 'decompose', 'split']],
    ['repo-analysis-agent', ['analyze', 'repository', 'codebase', 'structure']],

    // Coding agents
    ['backend-agent', ['backend', 'server', 'api', 'endpoint', 'service']],
    ['frontend-agent', ['frontend', 'ui', 'component', 'react', 'vue']],
    ['api-agent', ['api', 'rest', 'graphql', 'endpoint', 'route']],
    ['database-agent', ['database', 'sql', 'schema', 'migration', 'query']],
    ['auth-agent', ['auth', 'authentication', 'authorization', 'oauth', 'jwt', 'login']],

    // Testing agents
    ['unit-test-agent', ['unit', 'test', 'spec', 'jest', 'mocha']],
    ['integration-test-agent', ['integration', 'test', 'api', 'e2e']],
    ['build-verification-agent', ['build', 'compile', 'typescript']],
    ['lint-verification-agent', ['lint', 'eslint', 'style', 'format']],
  ]);

  /**
   * Route a task to appropriate agents
   */
  routeTask(task: string, memory: WorkspaceMemory): Agent[] {
    const taskLower = task.toLowerCase();

    // Classify the task
    const classification = this.classifyTask(taskLower);

    memory.info(`Task classified as: ${classification.category} (confidence: ${classification.confidence.toFixed(2)})`, 'agent-router');

    // Get agents for the primary category
    const primaryAgents = agentRegistry.getAgentsByCategory(classification.category);

    // Score each agent
    const scoredAgents = primaryAgents.map((agent) => ({
      agent,
      score: this.scoreAgent(agent, taskLower, classification),
    }));

    // Sort by score and return top agents
    scoredAgents.sort((a, b) => b.score - a.score);

    // Return top 3 agents
    const topAgents = scoredAgents.slice(0, 3).map((sa) => sa.agent);

    memory.info(
      `Routed to agents: ${topAgents.map((a) => a.name).join(', ')}`,
      'agent-router',
    );

    return topAgents;
  }

  /**
   * Classify task into a category
   */
  private classifyTask(taskLower: string): TaskClassification {
    const scores = new Map<AgentCategory, number>();

    // Score each category based on keyword matches
    for (const [category, keywords] of this.categoryKeywords) {
      let score = 0;

      for (const keyword of keywords) {
        if (taskLower.includes(keyword)) {
          score += 1;
        }
      }

      scores.set(category, score);
    }

    // Find the highest scoring category
    let bestCategory: AgentCategory = 'coding'; // Default
    let bestScore = 0;

    for (const [category, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    // Extract matching keywords
    const matchingKeywords = this.categoryKeywords
      .get(bestCategory)
      ?.filter((kw) => taskLower.includes(kw)) || [];

    // Calculate confidence (normalize by max possible matches)
    const maxPossible = this.categoryKeywords.get(bestCategory)?.length || 1;
    const confidence = Math.min(1, bestScore / maxPossible);

    return {
      category: bestCategory,
      keywords: matchingKeywords,
      confidence,
    };
  }

  /**
   * Score an agent for a specific task
   */
  private scoreAgent(
    agent: Agent,
    taskLower: string,
    classification: TaskClassification,
  ): number {
    let score = 0;

    // Base score from category match
    if (agent.category === classification.category) {
      score += 10;
    }

    // Bonus for specific keyword matches
    const agentKeywords = this.specificAgentKeywords.get(agent.name) || [];

    for (const keyword of agentKeywords) {
      if (taskLower.includes(keyword)) {
        score += 5;
      }
    }

    // Bonus for agent description match
    const descriptionWords = agent.description.toLowerCase().split(/\s+/);
    for (const word of descriptionWords) {
      if (word.length > 4 && taskLower.includes(word)) {
        score += 2;
      }
    }

    return score;
  }

  /**
   * Get recommended agents for a category
   */
  getAgentsForCategory(category: AgentCategory): Agent[] {
    return agentRegistry.getAgentsByCategory(category);
  }

  /**
   * Find agent by name
   */
  findAgent(name: string): Agent | undefined {
    return agentRegistry.getAgent(name);
  }

  /**
   * Get routing statistics
   */
  getRoutingStats(): {
    totalAgents: number;
    agentsByCategory: Record<AgentCategory, number>;
  } {
    return {
      totalAgents: agentRegistry.getAgentCount(),
      agentsByCategory: agentRegistry.getAgentCountByCategory(),
    };
  }
}
