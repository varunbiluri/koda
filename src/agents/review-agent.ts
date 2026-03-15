import * as path from 'node:path';
import { searchCode } from '../tools/filesystem-tools.js';
import { listFiles } from '../tools/filesystem-tools.js';
import { readFile } from '../tools/filesystem-tools.js';
import { logger } from '../utils/logger.js';

export interface ReviewIssue {
  file: string;
  line?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface ReviewReport {
  filesReviewed: number;
  issues: ReviewIssue[];
}

/** Patterns that signal potential review issues. */
const CHECKS: Array<{
  pattern: RegExp;
  message: string;
  severity: ReviewIssue['severity'];
}> = [
  {
    pattern: /query\s*\+|query\s*`|"\s*\+\s*\w+\s*\+\s*"/i,
    message: 'SQL injection risk — use parameterised queries',
    severity: 'error',
  },
  {
    pattern: /eval\s*\(/,
    message: 'Dangerous eval() call',
    severity: 'error',
  },
  {
    pattern: /TODO|FIXME|HACK/,
    message: 'Unresolved TODO / FIXME',
    severity: 'info',
  },
  {
    pattern: /console\.log\(/,
    message: 'console.log left in production code',
    severity: 'info',
  },
  {
    pattern: /password\s*=\s*['"`][^'"` ]{1,}/i,
    message: 'Possible hard-coded credential',
    severity: 'error',
  },
  {
    pattern: /if\s*\([^)]{80,}\)/,
    message: 'High complexity — condition exceeds 80 characters',
    severity: 'warning',
  },
  {
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
    message: 'Empty catch block silently swallows errors',
    severity: 'warning',
  },
  {
    pattern: /dangerouslySetInnerHTML/,
    message: 'XSS risk — dangerouslySetInnerHTML used',
    severity: 'error',
  },
];

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rb', '.php',
]);

/**
 * ReviewAgent — static-analysis code review.
 *
 * Scans all source files in the repository and returns findings grouped by file.
 */
export class ReviewAgent {
  constructor(private readonly rootPath: string) {}

  async run(): Promise<ReviewReport> {
    const files = await this.collectSourceFiles();
    const issues: ReviewIssue[] = [];

    for (const file of files) {
      const fileIssues = await this.reviewFile(file);
      issues.push(...fileIssues);
    }

    return { filesReviewed: files.length, issues };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async collectSourceFiles(): Promise<string[]> {
    const result = await listFiles('.', this.rootPath);
    if (!result.success) return [];

    const collected: string[] = [];
    await this.walkDir(this.rootPath, collected);
    return collected;
  }

  private async walkDir(dir: string, out: string[]): Promise<void> {
    const { readdir, stat } = await import('node:fs/promises');
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '.koda'].includes(entry.name)) continue;
        await this.walkDir(full, out);
      } else if (entry.isFile()) {
        if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          out.push(path.relative(this.rootPath, full));
        }
      }
    }
  }

  private async reviewFile(filePath: string): Promise<ReviewIssue[]> {
    const result = await readFile(filePath, this.rootPath);
    if (!result.success) return [];

    const lines = (result.data ?? '').split('\n');
    const issues: ReviewIssue[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const check of CHECKS) {
        if (check.pattern.test(line)) {
          issues.push({
            file: filePath,
            line: i + 1,
            severity: check.severity,
            message: check.message,
          });
        }
      }
    }

    return issues;
  }
}
