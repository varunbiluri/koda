/**
 * Structured tool result types.
 *
 * Tools can optionally return structured results alongside their string output.
 * ReasoningEngine converts these to human-readable context for the LLM,
 * reducing token usage compared to raw file dumps.
 *
 * Benefits:
 *   - Lower token usage (summary instead of full content)
 *   - Clearer reasoning context (structured metadata)
 *   - Less hallucination (specific fields vs. free-form text)
 */

// ── Structured result types ────────────────────────────────────────────────────

export interface ReadFileResult {
  kind:         'read_file';
  file:         string;
  startLine:    number;
  endLine:      number;
  /** Short AI-generated or heuristic summary of what the file section does. */
  summary?:     string;
  content:      string;
  /** Top-level exported function/class/interface names found in the file. */
  keyFunctions?: string[];
  /** Exact [startLine, endLine] tuple of the content slice. */
  lines?:        [number, number];
}

export interface GrepCodeResult {
  kind:    'grep_code';
  query:   string;
  matches: Array<{
    file:    string;
    line:    number;
    snippet: string;
  }>;
}

export interface SearchFilesResult {
  kind:    'search_files';
  pattern: string;
  files:   string[];
}

export interface ListDirectoryResult {
  kind:    'list_directory';
  path:    string;
  entries: Array<{
    name: string;
    type: 'file' | 'directory';
    size?: number;
  }>;
}

export type StructuredToolResult =
  | ReadFileResult
  | GrepCodeResult
  | SearchFilesResult
  | ListDirectoryResult;

// ── Formatters ─────────────────────────────────────────────────────────────────

/**
 * Convert a structured tool result to a compact, LLM-readable string.
 * Used by ToolRegistry as an alternative to raw string output.
 */
export function formatStructuredResult(result: StructuredToolResult): string {
  switch (result.kind) {
    case 'read_file': {
      const lineRange = result.lines
        ? `lines ${result.lines[0]}–${result.lines[1]}`
        : `lines ${result.startLine}–${result.endLine}`;
      const summaryPart = result.summary ? ` — ${result.summary}` : '';
      const header      = `// ${result.file} (${lineRange})${summaryPart}`;
      const keyFnPart   = result.keyFunctions && result.keyFunctions.length > 0
        ? `// Exports: ${result.keyFunctions.join(', ')}\n`
        : '';
      return `${header}\n${keyFnPart}${result.content}`;
    }

    case 'grep_code': {
      if (result.matches.length === 0) return 'No matches found.';
      const lines = result.matches.map(
        (m) => `${m.file}:${m.line}: ${m.snippet}`,
      );
      return `Grep results for "${result.query}":\n${lines.join('\n')}`;
    }

    case 'search_files': {
      if (result.files.length === 0) return 'No files found.';
      return `Files matching "${result.pattern}":\n${result.files.join('\n')}`;
    }

    case 'list_directory': {
      if (result.entries.length === 0) return 'Directory is empty.';
      const lines = result.entries.map((e) => {
        if (e.type === 'directory') return `${e.name}/`;
        return e.size !== undefined ? `${e.name} (${e.size} B)` : e.name;
      });
      return `Contents of ${result.path}:\n${lines.join('\n')}`;
    }
  }
}

/**
 * Build a ReadFileResult from raw file content.
 * Extracts line numbers and optionally derives a summary heuristic.
 */
export function buildReadFileResult(
  filePath: string,
  content:  string,
  limit:    number,
): ReadFileResult {
  const allLines   = content.split('\n');
  const truncated  = content.length > limit ? content.slice(0, limit) : content;
  const endLine    = truncated.split('\n').length;

  // Heuristic summary: look for exports or class declarations
  const summary = allLines
    .slice(0, 30)
    .find((l) => /^export\s+(class|function|interface|const|type|enum)\s+\w+/.test(l.trim()))
    ?.trim()
    .slice(0, 80);

  // Extract key exported names (functions, classes, interfaces, consts, types, enums)
  const keyFunctions: string[] = [];
  const exportPattern = /^export\s+(?:default\s+)?(?:async\s+)?(?:class|function|interface|const|type|enum)\s+(\w+)/;
  for (const line of allLines) {
    const m = line.trim().match(exportPattern);
    if (m?.[1]) keyFunctions.push(m[1]);
    if (keyFunctions.length >= 10) break;
  }

  return {
    kind:         'read_file',
    file:         filePath,
    startLine:    1,
    endLine,
    summary,
    content:      truncated,
    keyFunctions: keyFunctions.length > 0 ? keyFunctions : undefined,
    lines:        [1, endLine],
  };
}
