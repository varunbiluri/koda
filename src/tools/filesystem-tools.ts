import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { ToolResult } from './types.js';
import type { RepoIndex } from '../types/index.js';

export async function readFile(filePath: string, rootPath: string): Promise<ToolResult<string>> {
  try {
    const absolutePath = path.resolve(rootPath, filePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    return { success: true, data: content };
  } catch (err) {
    return {
      success: false,
      error: `Failed to read file ${filePath}: ${(err as Error).message}`,
    };
  }
}

export async function writeFile(
  filePath: string,
  content: string,
  rootPath: string,
): Promise<ToolResult<void>> {
  try {
    const absolutePath = path.resolve(rootPath, filePath);
    const dir = path.dirname(absolutePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to write file ${filePath}: ${(err as Error).message}`,
    };
  }
}

export async function deleteFile(filePath: string, rootPath: string): Promise<ToolResult<void>> {
  try {
    const absolutePath = path.resolve(rootPath, filePath);
    await fs.unlink(absolutePath);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to delete file ${filePath}: ${(err as Error).message}`,
    };
  }
}

export async function fileExists(filePath: string, rootPath: string): Promise<ToolResult<boolean>> {
  try {
    const absolutePath = path.resolve(rootPath, filePath);
    await fs.access(absolutePath);
    return { success: true, data: true };
  } catch {
    return { success: true, data: false };
  }
}

export async function listFiles(dirPath: string, rootPath: string): Promise<ToolResult<string[]>> {
  try {
    const absolutePath = path.resolve(rootPath, dirPath);
    const files = await fs.readdir(absolutePath);
    return { success: true, data: files };
  } catch (err) {
    return {
      success: false,
      error: `Failed to list files in ${dirPath}: ${(err as Error).message}`,
    };
  }
}

/** Try running ripgrep; resolves to null if rg is not installed. */
async function searchWithRipgrep(
  query: string,
  rootPath: string,
): Promise<{ file: string; line: number; content: string }[] | null> {
  return new Promise((resolve) => {
    const args = ['--line-number', '--no-heading', '--color', 'never', query, '.'];
    const rg = spawn('rg', args, { cwd: rootPath });

    let stdout = '';
    rg.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

    rg.on('error', () => resolve(null)); // rg not found

    rg.on('close', () => {
      const results: { file: string; line: number; content: string }[] = [];
      for (const raw of stdout.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        // Format: file:linenum:content
        const firstColon = line.indexOf(':');
        const secondColon = line.indexOf(':', firstColon + 1);
        if (firstColon === -1 || secondColon === -1) continue;
        const file = line.slice(0, firstColon);
        const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10);
        const content = line.slice(secondColon + 1).trim();
        if (!isNaN(lineNum)) {
          results.push({ file, line: lineNum, content });
        }
        if (results.length >= 100) break;
      }
      resolve(results);
    });
  });
}

export async function searchCode(
  pattern: string,
  rootPath: string,
  index?: RepoIndex,
): Promise<ToolResult<{ file: string; line: number; content: string }[]>> {
  try {
    // ── Fast path: search in-memory index when available ──────────────────
    if (index) {
      let regex: RegExp | null = null;
      try { regex = new RegExp(pattern); } catch { /* fallback to literal */ }

      const results: { file: string; line: number; content: string }[] = [];
      for (const chunk of index.chunks) {
        const lines = chunk.content.split('\n');
        lines.forEach((line, idx) => {
          const matched = regex ? regex.test(line) : line.includes(pattern);
          if (matched) {
            results.push({
              file: chunk.filePath,
              line: chunk.startLine + idx,
              content: line.trim(),
            });
          }
        });
        if (results.length >= 100) break;
      }
      return { success: true, data: results.slice(0, 100) };
    }

    // ── Primary: ripgrep ───────────────────────────────────────────────────
    const rgResults = await searchWithRipgrep(pattern, rootPath);
    if (rgResults !== null) {
      return { success: true, data: rgResults };
    }

    // ── Fallback: walk the file tree manually ──────────────────────────────
    let regex: RegExp | null = null;
    try { regex = new RegExp(pattern); } catch { /* fallback to literal */ }

    const results: { file: string; line: number; content: string }[] = [];

    async function searchDir(dir: string): Promise<void> {
      if (results.length >= 100) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= 100) break;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
          await searchDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');

            lines.forEach((line, index) => {
              if (results.length >= 100) return;
              const matched = regex ? regex.test(line) : line.includes(pattern);
              if (matched) {
                results.push({
                  file: path.relative(rootPath, fullPath),
                  line: index + 1,
                  content: line.trim(),
                });
              }
            });
          } catch {
            // Skip files that can't be read
          }
        }
      }
    }

    await searchDir(rootPath);
    return { success: true, data: results };
  } catch (err) {
    return {
      success: false,
      error: `Failed to search code: ${(err as Error).message}`,
    };
  }
}
