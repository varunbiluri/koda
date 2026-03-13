import { BaseAgent } from '../base-agent.js';
import type { AgentInput, AgentOutput } from '../types.js';
import type { WorkspaceMemory } from '../../memory/workspace-memory.js';
import { searchCode } from '../../tools/filesystem-tools.js';

export class RepoAnalysisAgent extends BaseAgent {
  constructor() {
    super(
      'repo-analysis-agent',
      'planning',
      'Analyzes repository structure, dependencies, and existing patterns',
    );
  }

  async execute(input: AgentInput, memory: WorkspaceMemory): Promise<AgentOutput> {
    try {
      memory.info('Analyzing repository structure', this.name);

      const repoIndex = memory.getRepoIndex();
      if (!repoIndex) {
        return this.failure('Repository index not available');
      }

      const analysis = {
        totalFiles: repoIndex.files.length,
        totalChunks: repoIndex.chunks.length,
        languages: this.analyzeLanguages(repoIndex),
        topFiles: this.findTopFiles(repoIndex),
        patterns: await this.detectPatterns(memory.rootPath),
        dependencies: repoIndex.edges.length,
      };

      memory.setContext('repoAnalysis', analysis);

      return this.success(analysis, {
        suggestions: [
          `Analyzed ${analysis.totalFiles} files`,
          `Found ${analysis.patterns.length} common patterns`,
          `Identified ${analysis.topFiles.length} key files`,
        ],
      });
    } catch (err) {
      return this.failure((err as Error).message);
    }
  }

  private analyzeLanguages(repoIndex: any): Record<string, number> {
    const languages: Record<string, number> = {};

    for (const file of repoIndex.files) {
      languages[file.language] = (languages[file.language] || 0) + 1;
    }

    return languages;
  }

  private findTopFiles(repoIndex: any): string[] {
    // Files with high in-degree (many imports) are likely important
    const topNodes = [...repoIndex.nodes]
      .sort((a: any, b: any) => b.inDegree - a.inDegree)
      .slice(0, 10)
      .map((n: any) => n.filePath);

    return topNodes;
  }

  private async detectPatterns(rootPath: string): Promise<string[]> {
    const patterns: string[] = [];

    // Search for common patterns
    const searches = [
      'class ',
      'interface ',
      'export ',
      'import ',
      'async ',
      'await ',
      'Promise',
    ];

    for (const pattern of searches) {
      const result = await searchCode(pattern, rootPath);
      if (result.success && result.data && result.data.length > 10) {
        patterns.push(`${pattern.trim()} (${result.data.length} occurrences)`);
      }
    }

    return patterns;
  }
}
