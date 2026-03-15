import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolResult } from './types.js';

export interface PatchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  linesReplaced: number;
  linesInserted: number;
}

/**
 * Apply a line-range patch to a file.
 * Reads the file, replaces lines startLine..endLine (1-indexed, inclusive),
 * writes it back, and returns a summary.
 */
export async function applyPatch(
  filePath: string,
  startLine: number,
  endLine: number,
  replacement: string,
  rootPath: string,
): Promise<ToolResult<PatchResult>> {
  try {
    const absolutePath = path.resolve(rootPath, filePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split('\n');

    const totalLines = lines.length;

    if (startLine < 1 || startLine > totalLines) {
      return {
        success: false,
        error: `startLine ${startLine} is out of range (file has ${totalLines} lines)`,
      };
    }
    if (endLine < startLine || endLine > totalLines) {
      return {
        success: false,
        error: `endLine ${endLine} is out of range (startLine=${startLine}, file has ${totalLines} lines)`,
      };
    }

    const replacementLines = replacement.split('\n');
    const linesReplaced = endLine - startLine + 1;

    // lines array is 0-indexed; startLine/endLine are 1-indexed
    const before = lines.slice(0, startLine - 1);
    const after = lines.slice(endLine);
    const patched = [...before, ...replacementLines, ...after];

    await fs.writeFile(absolutePath, patched.join('\n'), 'utf-8');

    return {
      success: true,
      data: {
        filePath,
        startLine,
        endLine,
        linesReplaced,
        linesInserted: replacementLines.length,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to apply patch to ${filePath}: ${(err as Error).message}`,
    };
  }
}
