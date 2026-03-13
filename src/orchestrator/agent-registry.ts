import type { Agent, AgentCategory } from '../agents/types.js';

// Planning agents
import { ArchitectureAgent } from '../agents/planning/architecture-agent.js';
import { TaskBreakdownAgent } from '../agents/planning/task-breakdown-agent.js';
import { RepoAnalysisAgent } from '../agents/planning/repo-analysis-agent.js';

// Coding agents
import { BackendAgent } from '../agents/coding/backend-agent.js';

// Testing agents
import { UnitTestAgent } from '../agents/testing/unit-test-agent.js';

// Verification agents
import {
  BuildVerificationAgent,
  TestVerificationAgent,
  LintVerificationAgent,
  TypeCheckVerificationAgent,
  ComprehensiveVerificationAgent,
} from '../agents/verification/index.js';

export class AgentRegistry {
  private agents: Map<string, Agent> = new Map();
  private categorized: Map<AgentCategory, Agent[]> = new Map();

  constructor() {
    this.registerAllAgents();
  }

  private registerAllAgents(): void {
    // Planning agents (6 total - 3 implemented, 3 stubs)
    this.register(new ArchitectureAgent());
    this.register(new TaskBreakdownAgent());
    this.register(new RepoAnalysisAgent());
    // TODO: Add remaining planning agents:
    // - DependencyAgent
    // - DesignAgent
    // - ImpactAnalysisAgent

    // Coding agents (12 total - 1 implemented, 11 stubs)
    this.register(new BackendAgent());
    // TODO: Add remaining coding agents:
    // - FrontendAgent, ApiAgent, DatabaseAgent, AuthAgent
    // - ValidationAgent, MiddlewareAgent, ErrorHandlingAgent
    // - ConfigAgent, LoggingAgent, WorkerAgent, CacheAgent

    // Testing agents (13 total - 6 implemented, 7 stubs)
    this.register(new UnitTestAgent());
    this.register(new BuildVerificationAgent());
    this.register(new TestVerificationAgent());
    this.register(new LintVerificationAgent());
    this.register(new TypeCheckVerificationAgent());
    this.register(new ComprehensiveVerificationAgent());
    // TODO: Add remaining testing agents:
    // - IntegrationTestAgent, E2ETestAgent, ApiTestAgent
    // - SecurityTestAgent, PerformanceTestAgent
    // - RegressionTestAgent, ContractTestAgent

    // TODO: Add debugging agents (8):
    // - RuntimeDebugAgent, StacktraceAgent, DependencyDebugAgent
    // - MemoryDebugAgent, AsyncDebugAgent, RaceConditionAgent
    // - TestFailureAgent, LintDebugAgent

    // TODO: Add review agents (8):
    // - SecurityReviewAgent, PerformanceReviewAgent, StyleReviewAgent
    // - RefactorAgent, MaintainabilityAgent, ComplexityReviewAgent
    // - DocumentationAgent, DependencyReviewAgent

    // TODO: Add optimization agents (5):
    // - PerformanceOptimizerAgent, BundleSizeAgent
    // - DatabaseQueryOptimizer, CacheStrategyAgent
    // - AsyncOptimizationAgent

    // TODO: Add infrastructure agents (3):
    // - DockerAgent, CICDAgent, DeploymentAgent
  }

  private register(agent: Agent): void {
    this.agents.set(agent.name, agent);

    if (!this.categorized.has(agent.category)) {
      this.categorized.set(agent.category, []);
    }
    this.categorized.get(agent.category)!.push(agent);
  }

  getAgent(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  getAgentsByCategory(category: AgentCategory): Agent[] {
    return this.categorized.get(category) || [];
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAgentNames(): string[] {
    return Array.from(this.agents.keys());
  }

  getCategories(): AgentCategory[] {
    return Array.from(this.categorized.keys());
  }

  getAgentCount(): number {
    return this.agents.size;
  }

  getAgentCountByCategory(): Record<AgentCategory, number> {
    const counts: Partial<Record<AgentCategory, number>> = {};
    for (const [category, agents] of this.categorized) {
      counts[category] = agents.length;
    }
    return counts as Record<AgentCategory, number>;
  }
}

// Singleton instance
export const agentRegistry = new AgentRegistry();
