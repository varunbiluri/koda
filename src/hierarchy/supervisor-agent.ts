import type { Agent, AgentInput, AgentOutput, ExecutionPlan, Task } from '../agents/types.js';
import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { ExecutionGraph } from './execution-graph.js';
import { AgentRouter } from './agent-router.js';

export type ExecutionStrategy =
  | 'simple' // Single-pass linear execution
  | 'parallel' // Maximum parallelization
  | 'staged' // Phased execution (planning → coding → testing)
  | 'iterative' // Iterative refinement
  | 'hierarchical'; // Full hierarchical coordination

export interface SupervisorDecision {
  strategy: ExecutionStrategy;
  coordinators: string[]; // List of coordinator names to activate
  executionGraph: ExecutionGraph;
  estimatedComplexity: number; // 1-10 scale
  reasoning: string;
}

export interface SupervisorContext {
  taskComplexity: number;
  repositorySize: number;
  availableAgents: number;
  budgetConstraints?: {
    maxTokens?: number;
    maxDuration?: number;
  };
}

/**
 * Supervisor Agent - Top-level orchestrator that analyzes tasks and coordinates execution
 *
 * Responsibilities:
 * - Analyze user requests for complexity and requirements
 * - Choose optimal execution strategy
 * - Select and coordinate appropriate agent groups
 * - Build execution dependency graphs
 * - Monitor execution progress and adapt as needed
 */
export class SupervisorAgent implements Agent {
  name = 'supervisor';
  category = 'planning' as const;
  description = 'Top-level orchestrator that coordinates execution strategy and agent groups';

  private router: AgentRouter;

  constructor() {
    this.router = new AgentRouter();
  }

  async execute(input: AgentInput, memory: WorkspaceMemory): Promise<AgentOutput> {
    memory.info('Supervisor analyzing task and planning execution strategy', this.name);

    try {
      // Step 1: Analyze the task
      const analysis = await this.analyzeTask(input.task, memory);
      memory.setContext('taskAnalysis', analysis);

      // Step 2: Choose execution strategy
      const strategy = this.chooseStrategy(analysis);
      memory.info(`Selected execution strategy: ${strategy}`, this.name);

      // Step 3: Build execution graph
      const graph = await this.buildExecutionGraph(input.task, strategy, memory);
      memory.setContext('executionGraph', graph);

      // Step 4: Select coordinators
      const coordinators = this.selectCoordinators(strategy, analysis);
      memory.info(`Activated coordinators: ${coordinators.join(', ')}`, this.name);

      // Step 5: Create supervisor decision
      const decision: SupervisorDecision = {
        strategy,
        coordinators,
        executionGraph: graph,
        estimatedComplexity: analysis.complexity,
        reasoning: analysis.reasoning,
      };

      memory.setContext('supervisorDecision', decision);

      return {
        agentName: this.name,
        success: true,
        result: decision,
        suggestions: [
          `Using ${strategy} execution strategy`,
          `Complexity score: ${analysis.complexity}/10`,
          `Activating ${coordinators.length} coordinators`,
        ],
        nextSteps: coordinators.map((c) => `Activate ${c} coordinator`),
      };
    } catch (error) {
      memory.error(`Supervisor planning failed: ${(error as Error).message}`, this.name);
      return {
        agentName: this.name,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Analyze task complexity and requirements
   */
  private async analyzeTask(
    task: string,
    memory: WorkspaceMemory,
  ): Promise<{ complexity: number; taskType: string; reasoning: string }> {
    // Analyze task characteristics
    const keywords = this.extractKeywords(task.toLowerCase());

    let complexity = 3; // Default medium complexity
    let taskType = 'general';
    const reasons: string[] = [];

    // Complexity indicators
    if (keywords.has('architecture') || keywords.has('design') || keywords.has('refactor')) {
      complexity += 3;
      reasons.push('architectural changes detected');
    }

    if (keywords.has('auth') || keywords.has('security') || keywords.has('oauth')) {
      complexity += 2;
      taskType = 'security';
      reasons.push('security-critical feature');
    }

    if (keywords.has('database') || keywords.has('migration') || keywords.has('schema')) {
      complexity += 2;
      taskType = 'database';
      reasons.push('database changes required');
    }

    if (keywords.has('api') || keywords.has('endpoint') || keywords.has('rest')) {
      complexity += 1;
      taskType = 'api';
      reasons.push('API development');
    }

    if (keywords.has('test') || keywords.has('testing')) {
      taskType = 'testing';
    }

    if (keywords.has('fix') || keywords.has('bug') || keywords.has('debug')) {
      taskType = 'debugging';
      reasons.push('bug fix required');
    }

    if (keywords.has('optimize') || keywords.has('performance')) {
      complexity += 1;
      taskType = 'optimization';
      reasons.push('performance optimization');
    }

    // Multi-file indicators
    if (keywords.has('entire') || keywords.has('all') || keywords.has('system')) {
      complexity += 2;
      reasons.push('system-wide changes');
    }

    complexity = Math.min(10, Math.max(1, complexity));

    return {
      complexity,
      taskType,
      reasoning: reasons.join(', ') || 'standard implementation task',
    };
  }

  /**
   * Extract keywords from task description
   */
  private extractKeywords(task: string): Set<string> {
    const words = task.split(/\s+/);
    const keywords = new Set<string>();

    const relevantWords = [
      'architecture', 'design', 'refactor', 'auth', 'authentication', 'security',
      'oauth', 'database', 'migration', 'schema', 'api', 'endpoint', 'rest',
      'test', 'testing', 'fix', 'bug', 'debug', 'optimize', 'performance',
      'entire', 'all', 'system', 'add', 'create', 'implement', 'update',
    ];

    for (const word of words) {
      const clean = word.replace(/[^a-z]/g, '');
      if (relevantWords.includes(clean)) {
        keywords.add(clean);
      }
    }

    return keywords;
  }

  /**
   * Choose execution strategy based on analysis
   */
  private chooseStrategy(analysis: {
    complexity: number;
    taskType: string;
  }): ExecutionStrategy {
    // Simple tasks: use simple strategy
    if (analysis.complexity <= 3) {
      return 'simple';
    }

    // Medium complexity: use staged approach
    if (analysis.complexity <= 6) {
      return 'staged';
    }

    // High complexity: use hierarchical coordination
    if (analysis.complexity >= 7) {
      return 'hierarchical';
    }

    // Specific task types
    switch (analysis.taskType) {
      case 'testing':
        return 'parallel';
      case 'debugging':
        return 'iterative';
      default:
        return 'staged';
    }
  }

  /**
   * Build execution graph for the task
   */
  private async buildExecutionGraph(
    task: string,
    strategy: ExecutionStrategy,
    memory: WorkspaceMemory,
  ): Promise<ExecutionGraph> {
    const graph = new ExecutionGraph();

    // Build graph based on strategy
    switch (strategy) {
      case 'simple':
        this.buildSimpleGraph(graph, task);
        break;
      case 'staged':
        this.buildStagedGraph(graph, task);
        break;
      case 'hierarchical':
        await this.buildHierarchicalGraph(graph, task, memory);
        break;
      case 'parallel':
        this.buildParallelGraph(graph, task);
        break;
      case 'iterative':
        this.buildIterativeGraph(graph, task);
        break;
    }

    return graph;
  }

  /**
   * Build simple linear graph
   */
  private buildSimpleGraph(graph: ExecutionGraph, task: string): void {
    const analyze = graph.addNode({
      id: 'analyze',
      description: 'Analyze requirements',
      type: 'planning',
      priority: 10,
      dependencies: [],
      status: 'pending',
    });

    const implement = graph.addNode({
      id: 'implement',
      description: task,
      type: 'coding',
      priority: 8,
      dependencies: [analyze],
      status: 'pending',
    });

    graph.addNode({
      id: 'verify',
      description: 'Verify implementation',
      type: 'testing',
      priority: 6,
      dependencies: [implement],
      status: 'pending',
    });
  }

  /**
   * Build staged execution graph (planning → coding → testing)
   */
  private buildStagedGraph(graph: ExecutionGraph, task: string): void {
    // Stage 1: Planning
    const architecture = graph.addNode({
      id: 'architecture',
      description: 'Design architecture',
      type: 'planning',
      priority: 10,
      dependencies: [],
      status: 'pending',
    });

    const breakdown = graph.addNode({
      id: 'breakdown',
      description: 'Break down into subtasks',
      type: 'planning',
      priority: 9,
      dependencies: [architecture],
      status: 'pending',
    });

    // Stage 2: Coding
    const implement = graph.addNode({
      id: 'implement',
      description: task,
      type: 'coding',
      priority: 8,
      dependencies: [breakdown],
      status: 'pending',
    });

    // Stage 3: Testing
    const test = graph.addNode({
      id: 'test',
      description: 'Create and run tests',
      type: 'testing',
      priority: 6,
      dependencies: [implement],
      status: 'pending',
    });

    graph.addNode({
      id: 'review',
      description: 'Review and optimize',
      type: 'review',
      priority: 4,
      dependencies: [test],
      status: 'pending',
    });
  }

  /**
   * Build hierarchical execution graph with coordinator nodes
   */
  private async buildHierarchicalGraph(
    graph: ExecutionGraph,
    task: string,
    memory: WorkspaceMemory,
  ): Promise<void> {
    // Use router to determine which agents are needed
    const agentSuggestions = this.router.routeTask(task, memory);

    // Group by category (coordinator type)
    const planningAgents = agentSuggestions.filter((a) => a.category === 'planning');
    const codingAgents = agentSuggestions.filter((a) => a.category === 'coding');
    const testingAgents = agentSuggestions.filter((a) => a.category === 'testing');

    // Create coordinator-level nodes
    const planningCoord = graph.addNode({
      id: 'planning-coordinator',
      description: 'Coordinate planning phase',
      type: 'planning',
      priority: 10,
      dependencies: [],
      status: 'pending',
      assignedAgent: 'planning-coordinator',
    });

    const codingCoord = graph.addNode({
      id: 'coding-coordinator',
      description: 'Coordinate implementation',
      type: 'coding',
      priority: 8,
      dependencies: [planningCoord],
      status: 'pending',
      assignedAgent: 'coding-coordinator',
    });

    const testingCoord = graph.addNode({
      id: 'testing-coordinator',
      description: 'Coordinate testing',
      type: 'testing',
      priority: 6,
      dependencies: [codingCoord],
      status: 'pending',
      assignedAgent: 'testing-coordinator',
    });

    graph.addNode({
      id: 'review-coordinator',
      description: 'Coordinate review',
      type: 'review',
      priority: 4,
      dependencies: [testingCoord],
      status: 'pending',
      assignedAgent: 'review-coordinator',
    });
  }

  /**
   * Build parallel execution graph
   */
  private buildParallelGraph(graph: ExecutionGraph, task: string): void {
    const setup = graph.addNode({
      id: 'setup',
      description: 'Setup test environment',
      type: 'planning',
      priority: 10,
      dependencies: [],
      status: 'pending',
    });

    // All tests can run in parallel after setup
    graph.addNode({
      id: 'unit-tests',
      description: 'Run unit tests',
      type: 'testing',
      priority: 8,
      dependencies: [setup],
      status: 'pending',
    });

    graph.addNode({
      id: 'integration-tests',
      description: 'Run integration tests',
      type: 'testing',
      priority: 8,
      dependencies: [setup],
      status: 'pending',
    });

    graph.addNode({
      id: 'lint',
      description: 'Run linter',
      type: 'testing',
      priority: 8,
      dependencies: [setup],
      status: 'pending',
    });
  }

  /**
   * Build iterative refinement graph
   */
  private buildIterativeGraph(graph: ExecutionGraph, task: string): void {
    const diagnose = graph.addNode({
      id: 'diagnose',
      description: 'Diagnose issue',
      type: 'debugging',
      priority: 10,
      dependencies: [],
      status: 'pending',
    });

    const fix = graph.addNode({
      id: 'fix',
      description: 'Apply fix',
      type: 'coding',
      priority: 8,
      dependencies: [diagnose],
      status: 'pending',
    });

    graph.addNode({
      id: 'verify',
      description: 'Verify fix',
      type: 'testing',
      priority: 6,
      dependencies: [fix],
      status: 'pending',
    });
  }

  /**
   * Select coordinators based on strategy
   */
  private selectCoordinators(
    strategy: ExecutionStrategy,
    analysis: { complexity: number; taskType: string },
  ): string[] {
    switch (strategy) {
      case 'simple':
        return ['planning-coordinator'];

      case 'staged':
        return ['planning-coordinator', 'coding-coordinator', 'testing-coordinator'];

      case 'hierarchical':
        return [
          'planning-coordinator',
          'coding-coordinator',
          'testing-coordinator',
          'review-coordinator',
        ];

      case 'parallel':
        return ['testing-coordinator'];

      case 'iterative':
        return ['debugging-coordinator', 'testing-coordinator'];

      default:
        return ['planning-coordinator', 'coding-coordinator'];
    }
  }
}
