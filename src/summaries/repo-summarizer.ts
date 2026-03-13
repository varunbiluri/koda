import type { RepoIndex } from '../types/repo-index.js';
import type { RepositorySummary, SummaryHierarchy, FileSummary, ModuleSummary } from './types.js';
import { FileSummarizer } from './file-summarizer.js';
import { ModuleSummarizer } from './module-summarizer.js';
import { basename } from 'path';

/**
 * RepoSummarizer - Creates hierarchical summaries of entire repositories
 *
 * Builds multi-level summaries: repository → modules → files
 */
export class RepoSummarizer {
  private fileSummarizer: FileSummarizer;
  private moduleSummarizer: ModuleSummarizer;

  constructor() {
    this.fileSummarizer = new FileSummarizer();
    this.moduleSummarizer = new ModuleSummarizer();
  }

  /**
   * Generate complete hierarchical summary from repository index
   */
  async summarize(repoIndex: RepoIndex): Promise<SummaryHierarchy> {
    const { metadata, files, chunks, edges } = repoIndex;

    // Step 1: Build dependency map
    const dependencyMap = this.buildDependencyMap(edges);

    // Step 2: Summarize all files
    const fileSummaries = await this.fileSummarizer.summarizeBatch(
      files,
      chunks,
      dependencyMap,
    );

    // Step 3: Build module hierarchy
    const rootModule = this.moduleSummarizer.buildHierarchy(
      fileSummaries,
      metadata.rootPath,
    );

    // Step 4: Create repository summary
    const repoSummary = this.createRepositorySummary(
      metadata.rootPath,
      rootModule,
      fileSummaries,
      metadata.createdAt,
    );

    // Step 5: Build lookup maps
    const modules = this.buildModuleMap(rootModule);
    const filesMap = new Map(fileSummaries.map((f) => [f.filePath, f]));

    return {
      repository: repoSummary,
      modules,
      files: filesMap,
    };
  }

  /**
   * Build dependency map from edges
   */
  private buildDependencyMap(edges: any[]): Map<string, string[]> {
    const map = new Map<string, string[]>();

    for (const edge of edges) {
      if (!map.has(edge.from)) {
        map.set(edge.from, []);
      }
      map.get(edge.from)!.push(edge.to);
    }

    return map;
  }

  /**
   * Create repository-level summary
   */
  private createRepositorySummary(
    rootPath: string,
    rootModule: ModuleSummary,
    allFiles: FileSummary[],
    createdAt: string,
  ): RepositorySummary {
    const name = basename(rootPath);

    // Detect main technologies
    const technologies = this.detectTechnologies(allFiles);

    // Find entry points
    const entryPoints = this.findEntryPoints(allFiles);

    // Generate architecture description
    const architecture = this.generateArchitecture(rootModule);

    // Generate overall purpose
    const purpose = this.generateRepositoryPurpose(name, rootModule, technologies);

    return {
      rootPath,
      name,
      purpose,
      architecture,
      modules: rootModule.submodules,
      totalFiles: rootModule.totalFiles,
      totalLines: rootModule.totalLines,
      mainTechnologies: technologies,
      entryPoints,
      createdAt,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Detect main technologies used in repository
   */
  private detectTechnologies(files: FileSummary[]): string[] {
    const languages = new Map<string, number>();
    const frameworks = new Set<string>();

    // Count languages
    for (const file of files) {
      languages.set(file.language, (languages.get(file.language) || 0) + 1);
    }

    // Detect frameworks from dependencies
    for (const file of files) {
      for (const dep of file.dependencies) {
        // React
        if (dep.includes('react')) frameworks.add('React');
        // Vue
        if (dep.includes('vue')) frameworks.add('Vue');
        // Express
        if (dep.includes('express')) frameworks.add('Express');
        // Fastify
        if (dep.includes('fastify')) frameworks.add('Fastify');
        // NestJS
        if (dep.includes('@nestjs')) frameworks.add('NestJS');
        // Next.js
        if (dep.includes('next')) frameworks.add('Next.js');
      }
    }

    // Build technology list
    const technologies: string[] = [];

    // Add languages (sorted by frequency)
    const sortedLangs = Array.from(languages.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([lang]) => lang);

    technologies.push(...sortedLangs);

    // Add frameworks
    technologies.push(...Array.from(frameworks).sort());

    return technologies;
  }

  /**
   * Find entry point files
   */
  private findEntryPoints(files: FileSummary[]): string[] {
    const entryPoints: string[] = [];

    for (const file of files) {
      const fileName = file.filePath.split('/').pop() || '';

      // Common entry point names
      if (
        fileName === 'index.ts' ||
        fileName === 'index.js' ||
        fileName === 'main.ts' ||
        fileName === 'main.js' ||
        fileName === 'app.ts' ||
        fileName === 'app.js' ||
        fileName === 'server.ts' ||
        fileName === 'server.js'
      ) {
        // Only top-level entry points
        const depth = file.filePath.split('/').length;
        if (depth <= 3) {
          entryPoints.push(file.filePath);
        }
      }
    }

    return entryPoints.slice(0, 5); // Limit to 5
  }

  /**
   * Generate architecture description
   */
  private generateArchitecture(rootModule: ModuleSummary): string {
    const modules = rootModule.submodules;

    if (modules.length === 0) {
      return 'Single-module application';
    }

    const moduleNames = modules.map((m) => m.name).sort();

    // Detect common patterns
    const hasAgents = moduleNames.includes('agents');
    const hasCLI = moduleNames.includes('cli');
    const hasAPI = moduleNames.includes('api') || moduleNames.includes('routes');
    const hasEngine = moduleNames.includes('engine');
    const hasTypes = moduleNames.includes('types');

    const components: string[] = [];

    if (hasCLI) components.push('CLI interface');
    if (hasAPI) components.push('API layer');
    if (hasEngine) components.push('processing engine');
    if (hasAgents) components.push('multi-agent system');
    if (hasTypes) components.push('type system');

    if (components.length > 0) {
      return `Modular architecture with ${components.join(', ')}`;
    }

    return `Modular architecture with ${modules.length} main modules`;
  }

  /**
   * Generate repository purpose
   */
  private generateRepositoryPurpose(
    name: string,
    rootModule: ModuleSummary,
    technologies: string[],
  ): string {
    // Check for specific patterns
    const modules = rootModule.submodules.map((m) => m.name.toLowerCase());

    if (modules.includes('agents') && modules.includes('orchestrator')) {
      return `${name} - Multi-agent AI system with orchestration and execution capabilities`;
    }

    if (modules.includes('cli') && modules.includes('engine')) {
      return `${name} - CLI tool with processing engine`;
    }

    if (modules.includes('api') && modules.includes('services')) {
      return `${name} - API service application`;
    }

    // Generic description
    const techStr = technologies.slice(0, 2).join(' and ');
    return `${name} - ${techStr} application`;
  }

  /**
   * Build flat module lookup map
   */
  private buildModuleMap(rootModule: ModuleSummary): Map<string, ModuleSummary> {
    const map = new Map<string, ModuleSummary>();

    const addModule = (module: ModuleSummary) => {
      map.set(module.modulePath, module);

      for (const submodule of module.submodules) {
        addModule(submodule);
      }
    };

    addModule(rootModule);

    return map;
  }

  /**
   * Get repository statistics
   */
  getStatistics(summary: RepositorySummary): {
    totalModules: number;
    totalFiles: number;
    totalLines: number;
    avgFilesPerModule: number;
    languageBreakdown: Record<string, number>;
  } {
    let totalModules = 0;

    const countModules = (modules: ModuleSummary[]): number => {
      let count = modules.length;
      for (const module of modules) {
        count += countModules(module.submodules);
      }
      return count;
    };

    totalModules = countModules(summary.modules);

    return {
      totalModules,
      totalFiles: summary.totalFiles,
      totalLines: summary.totalLines,
      avgFilesPerModule: totalModules > 0 ? Math.round(summary.totalFiles / totalModules) : 0,
      languageBreakdown: {}, // Would need file summaries to compute
    };
  }
}
