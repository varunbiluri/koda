import type { ExecutionPlan, AgentOutput } from '../agents/types.js';
import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { TaskDecomposer } from './task-decomposer.js';
import { AgentWaveScheduler } from './agent-wave-scheduler.js';
import { ArchitectureAgent } from '../agents/planning/architecture-agent.js';
import { RepoAnalysisAgent } from '../agents/planning/repo-analysis-agent.js';

export interface OrchestrationResult {
  success: boolean;
  plan: ExecutionPlan;
  outputs: AgentOutput[];
  filesModified: string[];
  summary: string;
  errors: string[];
}

export class AgentOrchestrator {
  private decomposer: TaskDecomposer;
  private scheduler: AgentWaveScheduler;
  private maxRetries: number = 2;

  constructor() {
    this.decomposer = new TaskDecomposer();
    this.scheduler = new AgentWaveScheduler();
  }

  async orchestrate(
    userTask: string,
    memory: WorkspaceMemory,
  ): Promise<OrchestrationResult> {
    memory.info('Starting orchestration', 'orchestrator');

    try {
      // Phase 1: Run initial planning agents
      await this.runPlanningPhase(memory);

      // Phase 2: Decompose task into subtasks
      const plan = await this.decomposer.decompose(userTask, memory);
      memory.setContext('executionPlan', plan);
      memory.info(`Created execution plan with ${plan.tasks.length} tasks in ${plan.waves.length} waves`, 'orchestrator');

      // Phase 3: Execute tasks wave by wave
      await this.executeWaves(plan, memory);

      // Phase 4: Collect results
      const result = this.collectResults(plan, memory);

      memory.info('Orchestration completed', 'orchestrator');
      return result;
    } catch (err) {
      memory.error(`Orchestration failed: ${(err as Error).message}`, 'orchestrator');
      return {
        success: false,
        plan: { tasks: [], waves: [] },
        outputs: [],
        filesModified: [],
        summary: `Orchestration failed: ${(err as Error).message}`,
        errors: [(err as Error).message],
      };
    }
  }

  private async runPlanningPhase(memory: WorkspaceMemory): Promise<void> {
    memory.info('Running planning phase', 'orchestrator');

    // Run architecture and repo analysis agents in parallel
    const architectureAgent = new ArchitectureAgent();
    const repoAgent = new RepoAnalysisAgent();

    const [archResult, repoResult] = await Promise.all([
      architectureAgent.execute({ task: memory.userTask }, memory),
      repoAgent.execute({ task: memory.userTask }, memory),
    ]);

    memory.recordAgentOutput(archResult);
    memory.recordAgentOutput(repoResult);
  }

  private async executeWaves(plan: ExecutionPlan, memory: WorkspaceMemory): Promise<void> {
    for (let i = 0; i < plan.waves.length; i++) {
      const wave = plan.waves[i];
      memory.info(`Executing wave ${i + 1}/${plan.waves.length} (${wave.length} tasks)`, 'orchestrator');

      const results = await this.scheduler.executeWave(wave, memory);

      // Check for failures and retry if needed
      const failures = Array.from(results.values()).filter((r) => !r.success);
      if (failures.length > 0 && i < plan.waves.length - 1) {
        memory.warn(`Wave ${i + 1} had ${failures.length} failures`, 'orchestrator');
        // Could implement retry logic here
      }
    }
  }

  private collectResults(plan: ExecutionPlan, memory: WorkspaceMemory): OrchestrationResult {
    const outputs = memory.getAllAgentOutputs();
    const successful = outputs.filter((o) => o.success);
    const failed = outputs.filter((o) => !o.success);

    const filesModified = new Set<string>();
    for (const output of outputs) {
      if (output.filesModified) {
        output.filesModified.forEach((f) => filesModified.add(f));
      }
    }

    const errors = failed.map((o) => `${o.agentName}: ${o.error}`);

    const summary = this.generateSummary(plan, successful.length, failed.length, filesModified.size);

    return {
      success: failed.length === 0,
      plan,
      outputs,
      filesModified: Array.from(filesModified),
      summary,
      errors,
    };
  }

  private generateSummary(
    plan: ExecutionPlan,
    successCount: number,
    failureCount: number,
    filesModified: number,
  ): string {
    return `
Execution Summary:
- Total tasks: ${plan.tasks.length}
- Successful: ${successCount}
- Failed: ${failureCount}
- Files modified: ${filesModified}
- Waves executed: ${plan.waves.length}
`.trim();
  }
}
