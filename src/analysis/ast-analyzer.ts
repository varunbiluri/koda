import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getParser } from '../engine/ast/parser-manager.js';
import { isLanguageSupported, SUPPORTED_LANGUAGES } from '../engine/ast/languages.js';
import { TypeScriptExtractor } from '../engine/ast/extractors/typescript-extractor.js';
import { PythonExtractor } from '../engine/ast/extractors/python-extractor.js';
import type { BaseExtractor } from '../engine/ast/extractors/base-extractor.js';
import { logger } from '../utils/logger.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ASTSymbol {
  type: string;
  name: string;
  line: number;
  endLine?: number;
}

export interface FileSymbols {
  file: string;
  symbols: ASTSymbol[];
  error?: string;
}

export interface ASTAnalysisResult {
  files: FileSymbols[];
  totalSymbols: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map each supported file extension to its language name. */
const EXT_TO_LANGUAGE: Record<string, string> = {};
for (const lang of SUPPORTED_LANGUAGES) {
  for (const ext of lang.extensions) {
    EXT_TO_LANGUAGE[ext] = lang.name;
  }
}

export function detectLanguageFromExtension(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? null;
}

function getExtractor(language: string): BaseExtractor | null {
  switch (language) {
    case 'typescript': return new TypeScriptExtractor();
    case 'python': return new PythonExtractor();
    default: return null;
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.koda']);

// ── ASTAnalyzer ───────────────────────────────────────────────────────────────

/**
 * ASTAnalyzer — public API for parsing source files and extracting symbols.
 *
 * Wraps the internal tree-sitter infrastructure used by the indexing pipeline
 * and exposes a clean interface for on-demand analysis.
 *
 * Example output:
 *   {
 *     file: "src/auth.ts",
 *     symbols: [
 *       { type: "function", name: "login", line: 24 },
 *       { type: "class", name: "AuthService", line: 5 }
 *     ]
 *   }
 */
export class ASTAnalyzer {
  constructor(private readonly rootPath: string) {}

  /**
   * Analyse a single file and return its symbols.
   * Accepts a path relative to rootPath or an absolute path.
   */
  async analyzeFile(filePath: string): Promise<FileSymbols> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.rootPath, filePath);
    const relativePath = path.relative(this.rootPath, absolutePath);

    const language = detectLanguageFromExtension(filePath);
    if (!language || !isLanguageSupported(language)) {
      return {
        file: relativePath,
        symbols: [],
        error: `Language not supported for ${path.extname(filePath) || filePath}`,
      };
    }

    let source: string;
    try {
      source = await fs.readFile(absolutePath, 'utf-8');
    } catch (err) {
      return { file: relativePath, symbols: [], error: `Cannot read file: ${(err as Error).message}` };
    }

    return this.parseSource(relativePath, language, source);
  }

  /**
   * Analyse all supported source files under dirPath (default: repository root).
   */
  async analyzeDirectory(dirPath: string = '.'): Promise<ASTAnalysisResult> {
    const absoluteDir = path.resolve(this.rootPath, dirPath);
    const filePaths = await this.collectSourceFiles(absoluteDir);

    const files = await Promise.all(filePaths.map((f) => this.analyzeFile(f)));
    const totalSymbols = files.reduce((n, r) => n + r.symbols.length, 0);

    return { files, totalSymbols };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async parseSource(
    relativePath: string,
    language: string,
    source: string,
  ): Promise<FileSymbols> {
    const [parser, extractor] = await Promise.all([
      getParser(language),
      Promise.resolve(getExtractor(language)),
    ]);

    if (!parser || !extractor) {
      return {
        file: relativePath,
        symbols: [],
        error: `No parser/extractor available for ${language}`,
      };
    }

    try {
      const tree = parser.parse(source);
      const extraction = extractor.extract(tree, source);
      const symbols: ASTSymbol[] = extraction.symbols.map((s) => ({
        type: s.type,
        name: s.name,
        line: s.startLine,
        endLine: s.endLine,
      }));
      return { file: relativePath, symbols };
    } catch (err) {
      logger.warn(`AST parse error in ${relativePath}: ${(err as Error).message}`);
      return { file: relativePath, symbols: [], error: (err as Error).message };
    }
  }

  private async collectSourceFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    await this.walk(dir, out);
    return out;
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await this.walk(full, out);
      } else if (entry.isFile()) {
        if (detectLanguageFromExtension(entry.name)) out.push(full);
      }
    }
  }
}

// ── Convenience function ──────────────────────────────────────────────────────

/**
 * Analyse a single file and return its symbols.
 *
 * @example
 *   const result = await analyzeFile('src/auth.ts', '/repo');
 *   // result.symbols → [ { type: 'function', name: 'login', line: 24 }, ... ]
 */
export async function analyzeFile(
  filePath: string,
  rootPath: string,
): Promise<FileSymbols> {
  return new ASTAnalyzer(rootPath).analyzeFile(filePath);
}
