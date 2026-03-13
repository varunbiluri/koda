import type { CodeChunk, ChunkType } from '../../types/index.js';
import type { ExtractedSymbol } from '../ast/extractors/base-extractor.js';
import { MAX_CHUNK_LINES } from '../../constants.js';

export function createChunks(
  filePath: string,
  language: string,
  symbols: ExtractedSymbol[],
  fullSource: string,
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = fullSource.split('\n');
  const totalLines = lines.length;

  // Sort symbols by start line
  const sorted = [...symbols].sort((a, b) => a.startLine - b.startLine);

  // Track which lines are covered by symbols
  const covered = new Set<number>();
  for (const sym of sorted) {
    for (let i = sym.startLine; i <= sym.endLine; i++) {
      covered.add(i);
    }
  }

  // Create chunks from symbols
  for (const sym of sorted) {
    if (sym.type === 'import') continue; // Skip import chunks — they're tracked separately

    const chunk = makeChunk(filePath, language, sym.name, sym.type, sym.content, sym.startLine, sym.endLine);
    chunks.push(...splitLargeChunk(chunk));
  }

  // Create misc chunks from uncovered lines
  let miscStart: number | null = null;
  let miscCount = 0;
  for (let lineNum = 1; lineNum <= totalLines; lineNum++) {
    if (!covered.has(lineNum)) {
      if (miscStart === null) miscStart = lineNum;
    } else {
      if (miscStart !== null) {
        const content = lines.slice(miscStart - 1, lineNum - 1).join('\n').trim();
        if (content.length > 0) {
          miscCount++;
          chunks.push(makeChunk(filePath, language, `misc_${miscCount}`, 'misc', content, miscStart, lineNum - 1));
        }
        miscStart = null;
      }
    }
  }
  // Trailing misc
  if (miscStart !== null) {
    const content = lines.slice(miscStart - 1).join('\n').trim();
    if (content.length > 0) {
      miscCount++;
      chunks.push(makeChunk(filePath, language, `misc_${miscCount}`, 'misc', content, miscStart, totalLines));
    }
  }

  return chunks;
}

function makeChunk(
  filePath: string,
  language: string,
  name: string,
  type: ChunkType,
  content: string,
  startLine: number,
  endLine: number,
): CodeChunk {
  return {
    id: `${filePath}#${name}`,
    filePath,
    name,
    type,
    content,
    startLine,
    endLine,
    language,
  };
}

function splitLargeChunk(chunk: CodeChunk): CodeChunk[] {
  const lines = chunk.content.split('\n');
  if (lines.length <= MAX_CHUNK_LINES) return [chunk];

  const parts: CodeChunk[] = [];
  let partStart = 0;
  let partIndex = 1;

  while (partStart < lines.length) {
    let partEnd = Math.min(partStart + MAX_CHUNK_LINES, lines.length);

    // Try to split at a blank line
    if (partEnd < lines.length) {
      for (let i = partEnd; i > partStart + Math.floor(MAX_CHUNK_LINES / 2); i--) {
        if (lines[i].trim() === '') {
          partEnd = i;
          break;
        }
      }
    }

    const content = lines.slice(partStart, partEnd).join('\n');
    parts.push({
      ...chunk,
      id: `${chunk.filePath}#${chunk.name}_part${partIndex}`,
      name: `${chunk.name}_part${partIndex}`,
      content,
      startLine: chunk.startLine + partStart,
      endLine: chunk.startLine + partEnd - 1,
    });

    partStart = partEnd;
    partIndex++;
  }

  return parts;
}
