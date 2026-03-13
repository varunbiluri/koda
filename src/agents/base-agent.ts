import type { Agent, AgentInput, AgentOutput, AgentCategory } from './types.js';
import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { ReasoningEngine } from '../ai/reasoning/reasoning-engine.js';
import { AzureAIProvider } from '../ai/providers/azure-provider.js';
import { loadConfig, configExists } from '../ai/config-store.js';

export abstract class BaseAgent implements Agent {
  constructor(
    public readonly name: string,
    public readonly category: AgentCategory,
    public readonly description: string,
  ) {}

  abstract execute(input: AgentInput, memory: WorkspaceMemory): Promise<AgentOutput>;

  protected async useAI(
    query: string,
    memory: WorkspaceMemory,
  ): Promise<string | null> {
    try {
      const hasConfig = await configExists();
      if (!hasConfig) {
        memory.warn('AI config not available, skipping AI reasoning', this.name);
        return null;
      }

      const repoIndex = memory.getRepoIndex();
      if (!repoIndex) {
        memory.warn('Repository index not available', this.name);
        return null;
      }

      const config = await loadConfig();
      const provider = new AzureAIProvider(config);
      const engine = new ReasoningEngine(repoIndex, provider);

      const result = await engine.analyze(query, { maxResults: 5 });
      return result.answer;
    } catch (err) {
      memory.error(`AI reasoning failed: ${(err as Error).message}`, this.name);
      return null;
    }
  }

  protected success(result?: unknown, additionalData?: Partial<AgentOutput>): AgentOutput {
    return {
      agentName: this.name,
      success: true,
      result,
      ...additionalData,
    };
  }

  protected failure(error: string): AgentOutput {
    return {
      agentName: this.name,
      success: false,
      error,
    };
  }
}
