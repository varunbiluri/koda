import type { SummaryHierarchy, FileSummary, ModuleSummary } from '../summaries/types.js';
import type { CodeChunk } from '../types/code-chunk.js';
import type { SearchResult } from '../types/vector.js';

export interface RetrievalResult {
  level: 'repository' | 'module' | 'file' | 'chunk';
  path: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface RetrievalContext {
  query: string;
  maxResults?: number;
  minScore?: number;
  levels?: ('repository' | 'module' | 'file' | 'chunk')[];
}

/**
 * HierarchicalRetriever - Multi-level code retrieval using summary hierarchy
 *
 * Query pipeline:
 * 1. Query repository summary
 * 2. Narrow to relevant modules
 * 3. Identify relevant files
 * 4. Retrieve specific code chunks
 */
export class HierarchicalRetriever {
  /**
   * Retrieve code at multiple levels of granularity
   */
  async retrieve(
    context: RetrievalContext,
    hierarchy: SummaryHierarchy,
    chunks: CodeChunk[],
  ): Promise<RetrievalResult[]> {
    const results: RetrievalResult[] = [];
    const queryLower = context.query.toLowerCase();

    const levels = context.levels || ['module', 'file', 'chunk'];

    // Level 1: Repository-level context
    if (levels.includes('repository')) {
      const repoResult = this.matchRepository(hierarchy.repository, queryLower);
      if (repoResult) results.push(repoResult);
    }

    // Level 2: Module-level matching
    if (levels.includes('module')) {
      const moduleResults = this.matchModules(hierarchy, queryLower);
      results.push(...moduleResults);
    }

    // Level 3: File-level matching
    if (levels.includes('file')) {
      const fileResults = this.matchFiles(hierarchy, queryLower);
      results.push(...fileResults);
    }

    // Level 4: Chunk-level matching
    if (levels.includes('chunk')) {
      const chunkResults = await this.matchChunks(chunks, queryLower, hierarchy);
      results.push(...chunkResults);
    }

    // Filter by score and limit
    return results
      .filter((r) => r.score >= (context.minScore || 0.3))
      .sort((a, b) => b.score - a.score)
      .slice(0, context.maxResults || 20);
  }

  /**
   * Match at repository level
   */
  private matchRepository(
    repo: any,
    query: string,
  ): RetrievalResult | null {
    const score = this.calculateTextScore(
      query,
      `${repo.name} ${repo.purpose} ${repo.architecture}`,
    );

    if (score < 0.3) return null;

    return {
      level: 'repository',
      path: repo.rootPath,
      content: `# ${repo.name}\n\n${repo.purpose}\n\n**Architecture:** ${repo.architecture}\n\n**Technologies:** ${repo.mainTechnologies.join(', ')}`,
      score,
      metadata: {
        totalFiles: repo.totalFiles,
        totalLines: repo.totalLines,
      },
    };
  }

  /**
   * Match at module level
   */
  private matchModules(
    hierarchy: SummaryHierarchy,
    query: string,
  ): RetrievalResult[] {
    const results: RetrievalResult[] = [];

    for (const [path, module] of hierarchy.modules) {
      const score = this.calculateTextScore(
        query,
        `${module.name} ${module.purpose} ${module.mainComponents.join(' ')}`,
      );

      if (score >= 0.3) {
        results.push({
          level: 'module',
          path,
          content: this.formatModuleSummary(module),
          score,
          metadata: {
            totalFiles: module.totalFiles,
            totalLines: module.totalLines,
            mainComponents: module.mainComponents,
          },
        });
      }
    }

    return results;
  }

  /**
   * Match at file level
   */
  private matchFiles(
    hierarchy: SummaryHierarchy,
    query: string,
  ): RetrievalResult[] {
    const results: RetrievalResult[] = [];

    for (const [path, file] of hierarchy.files) {
      const score = this.calculateTextScore(
        query,
        `${path} ${file.purpose} ${file.mainExports.join(' ')}`,
      );

      if (score >= 0.3) {
        results.push({
          level: 'file',
          path,
          content: this.formatFileSummary(file),
          score,
          metadata: {
            language: file.language,
            lineCount: file.lineCount,
            complexity: file.complexity,
            mainExports: file.mainExports,
          },
        });
      }
    }

    return results;
  }

  /**
   * Match at chunk level (most specific)
   */
  private async matchChunks(
    chunks: CodeChunk[],
    query: string,
    hierarchy: SummaryHierarchy,
  ): Promise<RetrievalResult[]> {
    const results: RetrievalResult[] = [];

    // First, identify relevant files from hierarchy
    const relevantFiles = new Set<string>();

    for (const [path, file] of hierarchy.files) {
      const fileScore = this.calculateTextScore(query, `${path} ${file.purpose}`);
      if (fileScore >= 0.2) {
        relevantFiles.add(path);
      }
    }

    // Then search chunks, prioritizing those in relevant files
    for (const chunk of chunks) {
      const inRelevantFile = relevantFiles.has(chunk.filePath);

      const score = this.calculateTextScore(
        query,
        `${chunk.name || ''} ${chunk.content}`,
      );

      // Boost score if in relevant file
      const finalScore = inRelevantFile ? score * 1.5 : score;

      if (finalScore >= 0.3) {
        results.push({
          level: 'chunk',
          path: `${chunk.filePath}:${chunk.startLine}`,
          content: chunk.content,
          score: Math.min(1, finalScore),
          metadata: {
            type: chunk.type,
            name: chunk.name,
            filePath: chunk.filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
          },
        });
      }
    }

    return results;
  }

  /**
   * Calculate text similarity score (simple keyword matching)
   */
  private calculateTextScore(query: string, text: string): number {
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const textLower = text.toLowerCase();

    if (queryWords.length === 0) return 0;

    let matches = 0;
    for (const word of queryWords) {
      if (textLower.includes(word)) {
        matches++;
      }
    }

    return matches / queryWords.length;
  }

  /**
   * Format module summary for display
   */
  private formatModuleSummary(module: ModuleSummary): string {
    const lines: string[] = [];

    lines.push(`## Module: ${module.name}`);
    lines.push('');
    lines.push(`**Purpose:** ${module.purpose}`);
    lines.push('');

    if (module.mainComponents.length > 0) {
      lines.push(`**Main Components:** ${module.mainComponents.join(', ')}`);
    }

    if (module.files.length > 0) {
      lines.push('');
      lines.push(`**Files (${module.files.length}):**`);
      module.files.slice(0, 5).forEach((f) => {
        lines.push(`- ${f.filePath.split('/').pop()}: ${f.purpose}`);
      });
      if (module.files.length > 5) {
        lines.push(`- ... and ${module.files.length - 5} more`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format file summary for display
   */
  private formatFileSummary(file: FileSummary): string {
    const lines: string[] = [];

    lines.push(`## File: ${file.filePath.split('/').pop()}`);
    lines.push('');
    lines.push(`**Path:** ${file.filePath}`);
    lines.push(`**Language:** ${file.language}`);
    lines.push(`**Purpose:** ${file.purpose}`);
    lines.push('');

    if (file.mainExports.length > 0) {
      lines.push(`**Exports:** ${file.mainExports.join(', ')}`);
    }

    lines.push(`**Complexity:** ${file.complexity}/10`);
    lines.push(`**Lines:** ${file.lineCount}`);

    return lines.join('\n');
  }

  /**
   * Get narrowed context (progressive refinement)
   */
  async getNarrowedContext(
    query: string,
    hierarchy: SummaryHierarchy,
    chunks: CodeChunk[],
  ): Promise<{
    relevantModules: ModuleSummary[];
    relevantFiles: FileSummary[];
    relevantChunks: CodeChunk[];
  }> {
    // Step 1: Find relevant modules
    const moduleResults = this.matchModules(hierarchy, query);
    const topModulePaths = new Set(
      moduleResults
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((r) => r.path),
    );

    const relevantModules = Array.from(hierarchy.modules.values()).filter((m) =>
      topModulePaths.has(m.modulePath),
    );

    // Step 2: Find relevant files within those modules
    const relevantFiles: FileSummary[] = [];
    for (const module of relevantModules) {
      relevantFiles.push(...module.files);
    }

    // Step 3: Find relevant chunks within those files
    const relevantFilePaths = new Set(relevantFiles.map((f) => f.filePath));
    const relevantChunks = chunks.filter((c) => relevantFilePaths.has(c.filePath));

    return {
      relevantModules,
      relevantFiles,
      relevantChunks,
    };
  }
}
