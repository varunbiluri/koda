import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import ignore, { type Ignore } from 'ignore';
import { DEFAULT_IGNORE_PATTERNS, BINARY_EXTENSIONS, MAX_FILE_SIZE } from '../constants.js';
import type { FileInfo } from '../types/index.js';
import { logger } from '../utils/logger.js';

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.dockerfile': 'dockerfile',
  '.xml': 'xml',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
};

export function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return null;
  const basename = path.basename(filePath).toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  return EXTENSION_TO_LANGUAGE[ext] ?? null;
}

async function loadGitignore(rootPath: string): Promise<Ignore> {
  const ig = ignore();
  ig.add(DEFAULT_IGNORE_PATTERNS);

  try {
    const gitignorePath = path.join(rootPath, '.gitignore');
    const content = await fs.readFile(gitignorePath, 'utf-8');
    ig.add(content);
  } catch {
    // No .gitignore — fine
  }

  return ig;
}

export interface DiscoveryResult {
  files: FileInfo[];
  warnings: string[];
}

export async function discoverFiles(rootPath: string): Promise<DiscoveryResult> {
  const ig = await loadGitignore(rootPath);
  const files: FileInfo[] = [];
  const warnings: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      warnings.push(`Cannot read directory: ${dir}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootPath, fullPath);

      if (ig.ignores(relPath)) continue;

      if (entry.isDirectory()) {
        // Also check with trailing slash for directory patterns
        if (!ig.ignores(relPath + '/')) {
          await walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const language = detectLanguage(fullPath);
      if (!language) continue;

      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        warnings.push(`Cannot stat: ${relPath}`);
        continue;
      }

      if (stat.size > MAX_FILE_SIZE) {
        warnings.push(`Skipping large file (${(stat.size / 1024).toFixed(0)}KB): ${relPath}`);
        continue;
      }

      if (stat.size === 0) continue;

      let content;
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch {
        warnings.push(`Cannot read: ${relPath}`);
        continue;
      }

      const hash = crypto.createHash('sha256').update(content).digest('hex');

      files.push({
        path: relPath,
        absolutePath: fullPath,
        language,
        size: stat.size,
        hash,
      });
    }
  }

  await walk(rootPath);

  logger.debug(`Discovered ${files.length} files`);
  return { files, warnings };
}
