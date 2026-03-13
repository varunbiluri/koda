import type { RetrievalResult } from './hierarchical-retriever.js';
import type { CodeChunk } from '../types/code-chunk.js';

export interface OptimizedContext {
  context: string;
  tokenCount: number;
  chunksIncluded: number;
  filesIncluded: Set<string>;
  summary: string;
}

export interface OptimizationOptions {
  maxTokens: number;
  priorityLevel?: 'repository' | 'module' | 'file' | 'chunk';
  includeFullFiles?: boolean;
  deduplicateContent?: boolean;
}

/**
 * ContextOptimizer - Reduces and optimizes context for AI reasoning
 *
 * Responsibilities:
 * - Reduce redundant context
 * - Limit token usage
 * - Prioritize important code
 * - Remove duplicate information
 */
export class ContextOptimizer {
  /**
   * Optimize retrieval results into minimal context
   */
  optimize(
    results: RetrievalResult[],
    options: OptimizationOptions,
  ): OptimizedContext {
    const { maxTokens, priorityLevel = 'chunk', deduplicateContent = true } = options;

    // Sort by priority level and score
    const sorted = this.prioritizeResults(results, priorityLevel);

    // Build context incrementally
    const contextParts: string[] = [];
    const filesIncluded = new Set<string>();
    let currentTokens = 0;
    let chunksIncluded = 0;

    // Deduplication set
    const seenContent = new Set<string>();

    for (const result of sorted) {
      // Estimate tokens (rough: 1 token ≈ 4 characters)
      const estimatedTokens = Math.ceil(result.content.length / 4);

      // Check if we exceed limit
      if (currentTokens + estimatedTokens > maxTokens) {
        break;
      }

      // Check for duplicate content
      if (deduplicateContent) {
        const contentHash = this.hashContent(result.content);
        if (seenContent.has(contentHash)) {
          continue; // Skip duplicate
        }
        seenContent.add(contentHash);
      }

      // Add to context
      contextParts.push(this.formatResult(result));
      currentTokens += estimatedTokens;
      chunksIncluded++;

      // Track files
      if (result.metadata?.filePath) {
        filesIncluded.add(result.metadata.filePath as string);
      } else if (result.level === 'file') {
        filesIncluded.add(result.path);
      }
    }

    // Generate summary
    const summary = this.generateContextSummary(contextParts.length, filesIncluded.size, currentTokens);

    return {
      context: contextParts.join('\n\n---\n\n'),
      tokenCount: currentTokens,
      chunksIncluded,
      filesIncluded,
      summary,
    };
  }

  /**
   * Prioritize results based on level preference
   */
  private prioritizeResults(
    results: RetrievalResult[],
    priorityLevel: 'repository' | 'module' | 'file' | 'chunk',
  ): RetrievalResult[] {
    const levelPriority: Record<string, number> = {
      repository: 4,
      module: 3,
      file: 2,
      chunk: 1,
    };

    return results.sort((a, b) => {
      // First sort by priority level
      const aPriority = levelPriority[a.level] === levelPriority[priorityLevel] ? 1 : 0;
      const bPriority = levelPriority[b.level] === levelPriority[priorityLevel] ? 1 : 0;

      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }

      // Then by score
      return b.score - a.score;
    });
  }

  /**
   * Format result for context inclusion
   */
  private formatResult(result: RetrievalResult): string {
    const lines: string[] = [];

    lines.push(`<!-- ${result.level.toUpperCase()}: ${result.path} (score: ${result.score.toFixed(2)}) -->`);
    lines.push('');
    lines.push(result.content);

    return lines.join('\n');
  }

  /**
   * Hash content for deduplication
   */
  private hashContent(content: string): string {
    // Simple hash - normalize whitespace and get first 100 chars
    const normalized = content.replace(/\s+/g, ' ').trim();
    return normalized.substring(0, 100);
  }

  /**
   * Generate summary of optimized context
   */
  private generateContextSummary(
    resultCount: number,
    fileCount: number,
    tokenCount: number,
  ): string {
    return `Context includes ${resultCount} code segments from ${fileCount} files (~${tokenCount} tokens)`;
  }

  /**
   * Optimize chunks specifically
   */
  optimizeChunks(
    chunks: CodeChunk[],
    maxTokens: number,
  ): CodeChunk[] {
    const optimized: CodeChunk[] = [];
    let currentTokens = 0;

    // Sort by relevance (prioritize functions and classes)
    const sorted = chunks.sort((a, b) => {
      const aScore = this.getChunkPriority(a);
      const bScore = this.getChunkPriority(b);
      return bScore - aScore;
    });

    for (const chunk of sorted) {
      const estimatedTokens = Math.ceil(chunk.content.length / 4);

      if (currentTokens + estimatedTokens <= maxTokens) {
        optimized.push(chunk);
        currentTokens += estimatedTokens;
      }
    }

    return optimized;
  }

  /**
   * Get priority score for chunk
   */
  private getChunkPriority(chunk: CodeChunk): number {
    let score = 0;

    // Type priority
    switch (chunk.type) {
      case 'class':
        score += 10;
        break;
      case 'function':
        score += 8;
        break;
      case 'interface':
        score += 7;
        break;
      case 'type_alias':
        score += 6;
        break;
      case 'export':
        score += 5;
        break;
      default:
        score += 3;
    }

    // Length penalty (prefer smaller, focused chunks)
    const length = chunk.content.length;
    if (length < 500) score += 3;
    else if (length < 1000) score += 2;
    else if (length < 2000) score += 1;

    // Name bonus (named chunks are usually more important)
    if (chunk.name && chunk.name.length > 0) {
      score += 2;
    }

    return score;
  }

  /**
   * Remove redundant imports and comments
   */
  cleanContent(content: string): string {
    const lines = content.split('\n');
    const cleaned: string[] = [];

    let inMultiLineComment = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (trimmed.length === 0) continue;

      // Skip single-line comments
      if (trimmed.startsWith('//')) continue;

      // Handle multi-line comments
      if (trimmed.startsWith('/*')) {
        inMultiLineComment = true;
      }

      if (inMultiLineComment) {
        if (trimmed.endsWith('*/')) {
          inMultiLineComment = false;
        }
        continue;
      }

      // Skip import statements (optional - can be useful)
      // if (trimmed.startsWith('import ')) continue;

      cleaned.push(line);
    }

    return cleaned.join('\n');
  }

  /**
   * Estimate token count for text
   */
  estimateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    // More accurate would use tiktoken or similar
    return Math.ceil(text.length / 4);
  }

  /**
   * Truncate context to fit token limit
   */
  truncateToLimit(context: string, maxTokens: number): string {
    const estimatedTokens = this.estimateTokens(context);

    if (estimatedTokens <= maxTokens) {
      return context;
    }

    // Calculate ratio
    const ratio = maxTokens / estimatedTokens;
    const targetLength = Math.floor(context.length * ratio);

    // Truncate at sentence or paragraph boundary
    const truncated = context.substring(0, targetLength);
    const lastParagraph = truncated.lastIndexOf('\n\n');
    const lastSentence = truncated.lastIndexOf('.');

    if (lastParagraph > targetLength * 0.8) {
      return truncated.substring(0, lastParagraph) + '\n\n[... truncated]';
    }

    if (lastSentence > targetLength * 0.8) {
      return truncated.substring(0, lastSentence + 1) + '\n\n[... truncated]';
    }

    return truncated + '\n\n[... truncated]';
  }
}
