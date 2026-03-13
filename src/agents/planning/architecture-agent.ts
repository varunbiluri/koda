import { BaseAgent } from '../base-agent.js';
import type { AgentInput, AgentOutput } from '../types.js';
import type { WorkspaceMemory } from '../../memory/workspace-memory.js';

export class ArchitectureAgent extends BaseAgent {
  constructor() {
    super(
      'architecture-agent',
      'planning',
      'Analyzes repository architecture and suggests design patterns',
    );
  }

  async execute(input: AgentInput, memory: WorkspaceMemory): Promise<AgentOutput> {
    try {
      memory.info(`Analyzing architecture for: ${input.task}`, this.name);

      // Use AI to analyze the task and repository structure
      const analysis = await this.useAI(
        `Analyze the repository architecture and suggest how to implement: ${input.task}.
        Focus on: design patterns, module structure, dependencies, and integration points.`,
        memory,
      );

      if (!analysis) {
        return this.failure('AI reasoning not available');
      }

      const recommendations = {
        analysis,
        patterns: this.extractPatterns(analysis),
        modules: this.identifyModules(analysis),
        integrationPoints: this.findIntegrationPoints(analysis),
      };

      memory.setContext('architectureRecommendations', recommendations);

      return this.success(recommendations, {
        suggestions: [
          'Review existing codebase patterns',
          'Identify affected modules',
          'Plan integration strategy',
        ],
      });
    } catch (err) {
      return this.failure((err as Error).message);
    }
  }

  private extractPatterns(analysis: string): string[] {
    const patterns: string[] = [];
    const keywords = ['singleton', 'factory', 'adapter', 'observer', 'strategy', 'middleware'];

    for (const keyword of keywords) {
      if (analysis.toLowerCase().includes(keyword)) {
        patterns.push(keyword);
      }
    }

    return patterns;
  }

  private identifyModules(analysis: string): string[] {
    const modules: string[] = [];
    const matches = analysis.match(/(\w+)\.(?:ts|js|tsx|jsx)/g);

    if (matches) {
      modules.push(...new Set(matches));
    }

    return modules;
  }

  private findIntegrationPoints(analysis: string): string[] {
    const points: string[] = [];

    if (analysis.includes('API')) points.push('API layer');
    if (analysis.includes('database')) points.push('Data layer');
    if (analysis.includes('middleware')) points.push('Middleware');
    if (analysis.includes('authentication') || analysis.includes('auth')) {
      points.push('Authentication');
    }

    return points;
  }
}
