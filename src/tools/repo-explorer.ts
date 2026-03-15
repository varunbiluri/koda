import * as fs   from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileMatch {
  /** File path relative to the repository root. */
  relativePath: string;
  /** Absolute file path. */
  absolutePath: string;
}

export interface GrepMatch {
  /** File path relative to the repository root. */
  file:    string;
  /** 1-indexed line number of the match. */
  line:    number;
  /** Full content of the matching line. */
  content: string;
}

export interface DirectoryEntry {
  name:  string;
  type:  'file' | 'directory';
  /** Size in bytes (files only). */
  size?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Directories that are never traversed during exploration. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.koda',
  '.next', '.nuxt', 'coverage', '__pycache__', '.tox',
]);

const MAX_SEARCH_FILES  = 500;   // cap for searchFiles()
const MAX_GREP_RESULTS  = 100;   // cap for grepCode()
const MAX_GREP_SIZE     = 512 * 1024; // skip files > 512 KiB in grep

// ── RepoExplorer ──────────────────────────────────────────────────────────────

/**
 * RepoExplorer — lightweight filesystem exploration tools for the AI.
 *
 * Unlike the retrieval layer (TF-IDF + embeddings), these tools operate
 * directly on the filesystem and are useful when the AI needs to:
 *   - Find files matching a glob-like pattern before reading them.
 *   - Grep for an exact identifier across the whole codebase.
 *   - Browse a directory to understand its structure.
 *
 * All paths returned are relative to `rootPath` for portability.
 */
export class RepoExplorer {
  constructor(private readonly rootPath: string) {}

  // ── searchFiles ────────────────────────────────────────────────────────────

  /**
   * Find files whose paths match a glob-like pattern.
   *
   * Supports:
   *   - `*`   — matches any character except `/`
   *   - `**`  — matches any path segment (recursive)
   *   - `?`   — matches a single character
   *   - Literal path prefixes (e.g. `src/auth`)
   *
   * @param pattern - Glob pattern relative to the repository root.
   * @returns Up to MAX_SEARCH_FILES matching file paths (relative).
   */
  async searchFiles(pattern: string): Promise<FileMatch[]> {
    const regex  = this._globToRegex(pattern);
    const result: FileMatch[] = [];
    await this._walkDir(this.rootPath, async (absPath) => {
      if (result.length >= MAX_SEARCH_FILES) return;
      const rel = path.relative(this.rootPath, absPath);
      if (regex.test(rel)) {
        result.push({ relativePath: rel, absolutePath: absPath });
      }
    });
    logger.debug(`[repo-explorer] searchFiles("${pattern}") → ${result.length} match(es)`);
    return result;
  }

  // ── grepCode ──────────────────────────────────────────────────────────────

  /**
   * Search all text files for lines matching a string or regex pattern.
   *
   * @param query     - Plain-text string or regex pattern (e.g. `"function auth"` or `/export\s+class/`).
   * @param fileGlob  - Optional glob to restrict which files are searched.
   * @returns Up to MAX_GREP_RESULTS matching lines with file path and line number.
   */
  async grepCode(query: string, fileGlob?: string): Promise<GrepMatch[]> {
    let regex: RegExp;
    try {
      // If query looks like /pattern/flags, parse as regex; else treat as literal
      const regexLiteral = /^\/(.+)\/([gimsuy]*)$/.exec(query);
      regex = regexLiteral
        ? new RegExp(regexLiteral[1], regexLiteral[2])
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch {
      return [];
    }

    const globRegex = fileGlob ? this._globToRegex(fileGlob) : null;
    const results: GrepMatch[] = [];

    await this._walkDir(this.rootPath, async (absPath) => {
      if (results.length >= MAX_GREP_RESULTS) return;
      const rel = path.relative(this.rootPath, absPath);
      if (globRegex && !globRegex.test(rel)) return;

      // Skip binary-looking files by extension
      const ext = path.extname(absPath).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2',
           '.ttf', '.eot', '.zip', '.tar', '.gz', '.bin', '.exe', '.so', '.dylib']
          .includes(ext)) return;

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try { stat = await fs.stat(absPath); } catch { return; }
      if (stat.size > MAX_GREP_SIZE) return;

      let content: string;
      try { content = await fs.readFile(absPath, 'utf-8'); } catch { return; }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= MAX_GREP_RESULTS) break;
        if (regex.test(lines[i])) {
          results.push({ file: rel, line: i + 1, content: lines[i].trim() });
        }
      }
    });

    logger.debug(`[repo-explorer] grepCode("${query}") → ${results.length} match(es)`);
    return results;
  }

  // ── listDirectory ─────────────────────────────────────────────────────────

  /**
   * List the immediate contents of a directory (non-recursive).
   *
   * @param dirPath - Directory path relative to the repository root.
   *                  Use `"."` for the root.
   */
  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    const abs = path.resolve(this.rootPath, dirPath);

    // Containment check
    const root = path.resolve(this.rootPath);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`listDirectory: path "${dirPath}" escapes repository root`);
    }

    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true, encoding: 'utf-8' });
    } catch (err) {
      throw new Error(`listDirectory: cannot read "${dirPath}": ${(err as Error).message}`);
    }

    const result: DirectoryEntry[] = [];
    for (const entry of entries) {
      const name = entry.name as string;
      if (entry.isDirectory()) {
        result.push({ name, type: 'directory' });
      } else if (entry.isFile()) {
        let size: number | undefined;
        try {
          const s = await fs.stat(path.join(abs, name));
          size = s.size;
        } catch {/* ignore */}
        result.push({ name, type: 'file', size });
      }
    }

    // Sort: directories first, then files, both alphabetically
    result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    logger.debug(`[repo-explorer] listDirectory("${dirPath}") → ${result.length} entries`);
    return result;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Recursively walk a directory, calling `onFile` for each regular file. */
  private async _walkDir(
    dir:    string,
    onFile: (absPath: string) => Promise<void>,
  ): Promise<void> {
    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf-8' });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name as string)) continue;
        await this._walkDir(path.join(dir, entry.name as string), onFile);
      } else if (entry.isFile()) {
        await onFile(path.join(dir, entry.name as string));
      }
    }
  }

  /** Convert a glob pattern to a RegExp. */
  private _globToRegex(pattern: string): RegExp {
    // Escape regex special chars except * and ?
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

    // Use null-byte placeholders so that later `*` replacements don't
    // re-process the special sequences we've already substituted.
    const PH_DSLASH = '\x00A';   // placeholder for **/
    const PH_DSTAR  = '\x00B';   // placeholder for **
    const PH_STAR   = '\x00C';   // placeholder for *
    const PH_QUEST  = '\x00D';   // placeholder for ?

    const regexStr = escaped
      // Step 1: protect ** in **/  (order matters — do this before **)
      .replace(/\*\*\//g,  PH_DSLASH)
      // Step 2: protect remaining **
      .replace(/\*\*/g,    PH_DSTAR)
      // Step 3: protect *
      .replace(/\*/g,      PH_STAR)
      // Step 4: protect ?
      .replace(/\?/g,      PH_QUEST)
      // Step 5: expand placeholders to regex fragments
      .replace(/\x00A/g, '(?:[^/]+/)*')   // **/ → zero-or-more dir/ segments
      .replace(/\x00B/g, '.*')             // ** → any chars
      .replace(/\x00C/g, '[^/]*')          // * → non-slash chars
      .replace(/\x00D/g, '[^/]');          // ? → single non-slash char

    return new RegExp(`(^|/)${regexStr}$`, 'i');
  }
}
