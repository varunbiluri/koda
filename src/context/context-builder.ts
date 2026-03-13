import type { CodeChunk } from '../types/index.js';

export interface ContextChunk {
  filePath: string;
  name: string;
  type: string;
  content: string;
  startLine: number;
  endLine: number;
}

export interface BuildContextResult {
  context: string;
  chunks: ContextChunk[];
  estimatedTokens: number;
  truncated: boolean;
}

// Simple token estimation: ~4 characters per token (conservative estimate)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildContext(
  chunks: CodeChunk[],
  maxTokens: number = 8000,
): BuildContextResult {
  const contextChunks: ContextChunk[] = [];
  const lines: string[] = [];
  let estimatedTokens = 0;
  let truncated = false;

  // Group chunks by file for better context
  const fileGroups = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    if (!fileGroups.has(chunk.filePath)) {
      fileGroups.set(chunk.filePath, []);
    }
    fileGroups.get(chunk.filePath)!.push(chunk);
  }

  // Build context file by file
  for (const [filePath, fileChunks] of fileGroups) {
    const fileHeader = `\n## File: ${filePath}\n`;
    const headerTokens = estimateTokens(fileHeader);

    if (estimatedTokens + headerTokens > maxTokens) {
      truncated = true;
      break;
    }

    lines.push(fileHeader);
    estimatedTokens += headerTokens;

    for (const chunk of fileChunks) {
      const chunkHeader = `### ${chunk.type}: ${chunk.name} (lines ${chunk.startLine}-${chunk.endLine})\n`;
      const chunkContent = `\`\`\`${chunk.language}\n${chunk.content}\n\`\`\`\n`;
      const fullChunk = chunkHeader + chunkContent;
      const chunkTokens = estimateTokens(fullChunk);

      if (estimatedTokens + chunkTokens > maxTokens) {
        truncated = true;
        break;
      }

      lines.push(fullChunk);
      estimatedTokens += chunkTokens;

      contextChunks.push({
        filePath: chunk.filePath,
        name: chunk.name,
        type: chunk.type,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      });
    }

    if (truncated) break;
  }

  return {
    context: lines.join(''),
    chunks: contextChunks,
    estimatedTokens,
    truncated,
  };
}

export function formatFileReferences(chunks: ContextChunk[]): string {
  const files = new Set(chunks.map(c => c.filePath));
  return Array.from(files)
    .map((f, i) => `${i + 1}. ${f}`)
    .join('\n');
}
