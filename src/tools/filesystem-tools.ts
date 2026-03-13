import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolResult } from './types.js';

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

export async function searchCode(
  pattern: string,
  rootPath: string,
): Promise<ToolResult<{ file: string; line: number; content: string }[]>> {
  try {
    // Simple grep-like search (could be enhanced with ripgrep integration)
    const results: { file: string; line: number; content: string }[] = [];

    async function searchDir(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip common ignore patterns
          if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
            continue;
          }
          await searchDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');

            lines.forEach((line, index) => {
              if (line.includes(pattern)) {
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
