import type { FileInfo } from '../types/file-info.js';
import type { CodeChunk } from '../types/code-chunk.js';
import type { FileSummary } from './types.js';
import { readFile } from 'fs/promises';

/**
 * FileSummarizer - Creates summaries of individual files
 *
 * Analyzes file content, exports, imports, and generates concise summaries
 */
export class FileSummarizer {
  /**
   * Summarize a single file
   */
  async summarize(
    fileInfo: FileInfo,
    chunks: CodeChunk[],
    dependencies: string[],
  ): Promise<FileSummary> {
    // Get file chunks
    const fileChunks = chunks.filter((c) => c.filePath === fileInfo.path);

    // Extract main exports from chunks
    const mainExports = this.extractExports(fileChunks);

    // Calculate complexity
    const complexity = this.calculateComplexity(fileInfo, fileChunks);

    // Generate purpose summary
    const purpose = this.generatePurpose(fileInfo, fileChunks, mainExports);

    // Calculate line count from file size (rough estimate)
    const estimatedLines = Math.max(1, Math.round(fileInfo.size / 40));

    return {
      filePath: fileInfo.path,
      language: fileInfo.language,
      lineCount: estimatedLines,
      purpose,
      mainExports,
      dependencies,
      complexity,
      lastModified: fileInfo.hash,
    };
  }

  /**
   * Summarize multiple files in batch
   */
  async summarizeBatch(
    files: FileInfo[],
    allChunks: CodeChunk[],
    dependencyMap: Map<string, string[]>,
  ): Promise<FileSummary[]> {
    const summaries: FileSummary[] = [];

    for (const file of files) {
      const chunks = allChunks.filter((c) => c.filePath === file.path);
      const deps = dependencyMap.get(file.path) || [];

      const summary = await this.summarize(file, chunks, deps);
      summaries.push(summary);
    }

    return summaries;
  }

  /**
   * Extract main exports from code chunks
   */
  private extractExports(chunks: CodeChunk[]): string[] {
    const exports = new Set<string>();

    for (const chunk of chunks) {
      // Extract from function and class chunks
      if (chunk.type === 'function' || chunk.type === 'class') {
        if (chunk.name) {
          exports.add(chunk.name);
        }
      }

      // Extract from export chunks
      if (chunk.type === 'export') {
        const exportMatch = chunk.content.match(/export\s+(?:const|let|var|function|class)\s+(\w+)/);
        if (exportMatch) {
          exports.add(exportMatch[1]);
        }
      }
    }

    // Return top exports (limit to 10)
    return Array.from(exports).slice(0, 10);
  }

  /**
   * Calculate file complexity (1-10 scale)
   */
  private calculateComplexity(fileInfo: FileInfo, chunks: CodeChunk[]): number {
    let score = 1;

    // Line count factor (estimate from file size)
    const estimatedLines = Math.round(fileInfo.size / 40);
    if (estimatedLines > 500) score += 3;
    else if (estimatedLines > 200) score += 2;
    else if (estimatedLines > 100) score += 1;

    // Chunk count factor
    if (chunks.length > 20) score += 2;
    else if (chunks.length > 10) score += 1;

    // Nesting analysis (based on indentation in content)
    const maxDepth = this.estimateMaxDepth(chunks);
    if (maxDepth > 3) score += 2;
    else if (maxDepth > 2) score += 1;

    // Function/class count
    const functionCount = chunks.filter((c) => c.type === 'function').length;
    const classCount = chunks.filter((c) => c.type === 'class').length;

    if (functionCount + classCount > 15) score += 2;
    else if (functionCount + classCount > 8) score += 1;

    return Math.min(10, Math.max(1, score));
  }

  /**
   * Generate purpose description for file
   */
  private generatePurpose(
    fileInfo: FileInfo,
    chunks: CodeChunk[],
    exports: string[],
  ): string {
    const fileName = fileInfo.path.split('/').pop() || '';
    const baseName = fileName.replace(/\.[^.]+$/, '');

    // Detect common patterns
    if (fileName.match(/test\.(ts|js|tsx|jsx)$/)) {
      return `Test file for ${baseName.replace(/\.test$/, '')}`;
    }

    if (fileName.match(/spec\.(ts|js)$/)) {
      return `Spec file for ${baseName.replace(/\.spec$/, '')}`;
    }

    if (fileName === 'index.ts' || fileName === 'index.js') {
      return 'Module entry point and exports';
    }

    if (fileName === 'types.ts' || fileName === 'types.d.ts') {
      return 'TypeScript type definitions';
    }

    if (fileName.match(/config\./)) {
      return 'Configuration file';
    }

    if (fileName.match(/utils?\./)) {
      return 'Utility functions';
    }

    if (fileName.match(/constants?\./)) {
      return 'Constants and configuration values';
    }

    // Analyze chunks
    const hasClasses = chunks.some((c) => c.type === 'class');
    const hasFunctions = chunks.some((c) => c.type === 'function');

    if (hasClasses && chunks.filter((c) => c.type === 'class').length === 1) {
      const className = chunks.find((c) => c.type === 'class')?.name || baseName;
      return `Implements ${className} class`;
    }

    if (exports.length > 0) {
      const topExports = exports.slice(0, 3).join(', ');
      return `Exports ${topExports}${exports.length > 3 ? ', and more' : ''}`;
    }

    if (hasFunctions) {
      return `Utility functions for ${baseName}`;
    }

    return `${baseName} module`;
  }

  /**
   * Estimate maximum nesting depth from chunks
   */
  private estimateMaxDepth(chunks: CodeChunk[]): number {
    let maxDepth = 0;

    for (const chunk of chunks) {
      // Estimate depth from indentation
      const lines = chunk.content.split('\n');
      for (const line of lines) {
        const leadingSpaces = line.match(/^(\s*)/)?.[1].length || 0;
        const depth = Math.floor(leadingSpaces / 2);
        maxDepth = Math.max(maxDepth, depth);
      }
    }

    return maxDepth;
  }

  /**
   * Get file category based on path and content
   */
  getFileCategory(filePath: string): string {
    const path = filePath.toLowerCase();

    if (path.includes('/test/') || path.includes('/tests/') || path.match(/\.test\.(ts|js)/)) {
      return 'test';
    }

    if (path.includes('/cli/') || path.includes('/commands/')) {
      return 'cli';
    }

    if (path.includes('/types/') || path.match(/types?\.(ts|d\.ts)$/)) {
      return 'types';
    }

    if (path.includes('/utils/') || path.includes('/helpers/')) {
      return 'utility';
    }

    if (path.includes('/agents/')) {
      return 'agent';
    }

    if (path.includes('/engine/')) {
      return 'engine';
    }

    if (path.includes('/api/') || path.includes('/routes/')) {
      return 'api';
    }

    if (path.match(/config\./)) {
      return 'configuration';
    }

    return 'implementation';
  }
}
