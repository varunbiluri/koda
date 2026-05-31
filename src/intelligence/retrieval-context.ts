/**
 * RetrievalContext — symbol-aware repository bootstrap for the agent system prompt.
 *
 * Combines hybrid retrieval hits with indexed symbol metadata so the model
 * knows *what* to open without inlining file bodies (token-efficient).
 */

import type { RepoIndex } from '../types/index.js';
import type { CodeChunk } from '../types/code-chunk.js';

export interface RetrievalBootstrap {
  /** Compact markdown block for system prompt injection. */
  block: string;
  filePaths: string[];
  estimatedTokens: number;
}

const MAX_FILES  = 8;
const MAX_SYMBOLS = 12;

/**
 * Create a compact, symbol-aware bootstrap used to seed an agent prompt from retrieval hits.
 *
 * Produces a markdown block listing relevant file paths, key symbols, and optional related modules,
 * along with the selected file paths and an estimated token count.
 *
 * @param query - The user query used to focus the bootstrap content
 * @param chunks - Retrieved code chunks used to derive file paths and key symbols
 * @param index - Optional repository index used to compute related modules; pass `null` to omit related modules
 * @returns A RetrievalBootstrap containing the markdown `block`, the selected `filePaths`, and `estimatedTokens`
 */
export function buildRetrievalBootstrap(
  query: string,
  chunks: CodeChunk[],
  index: RepoIndex | null,
): RetrievalBootstrap {
  if (chunks.length === 0) {
    return { block: '', filePaths: [], estimatedTokens: 0 };
  }

  const filePaths = Array.from(new Set(chunks.map((c) => c.filePath))).slice(0, MAX_FILES);

  const symbols = chunks
    .slice(0, MAX_SYMBOLS)
    .map((c) => `${c.name} (${c.type}) @ ${c.filePath}:${c.startLine}`)
    .filter((s, i, arr) => arr.indexOf(s) === i);

  const related = index
    ? findRelatedModules(query, index, filePaths)
    : [];

  const lines = [
    '',
    '## Repository Intelligence (indexed bootstrap)',
    '',
    `Query focus: ${query.slice(0, 120)}`,
    '',
    'Relevant files:',
    ...filePaths.map((f) => `- ${f}`),
    '',
    'Key symbols:',
    ...symbols.map((s) => `- ${s}`),
  ];

  if (related.length > 0) {
    lines.push('', 'Related modules:', ...related.map((m) => `- ${m}`));
  }

  lines.push(
    '',
    'Use search_files → grep_code → read_file (optionally with startLine/endLine).',
    'Large tool outputs are stored as references — use get_tool_result to fetch sections.',
  );

  const block = lines.join('\n');
  return {
    block,
    filePaths,
    estimatedTokens: Math.ceil(block.length / 4),
  };
}

/**
 * Selects up to five repository module paths whose file paths overlap significant terms from the query.
 *
 * @param query - The user query used to extract significant search terms (words longer than 3 characters)
 * @param index - Repository index containing a list of files to scan for matching paths
 * @param exclude - File paths to ignore when selecting related modules
 * @returns An array of unique module identifiers (the first two path segments joined with `/`, or the full path if shorter), limited to at most five entries
 */
function findRelatedModules(query: string, index: RepoIndex, exclude: string[]): string[] {
  const terms = new Set(
    query.toLowerCase().split(/\W+/).filter((w) => w.length > 3),
  );
  if (terms.size === 0) return [];

  const excluded = new Set(exclude);
  const modules  = new Set<string>();

  for (const file of index.files) {
    if (excluded.has(file.path)) continue;
    const lower = file.path.toLowerCase();
    for (const term of terms) {
      if (lower.includes(term)) {
        modules.add(file.path.split('/').slice(0, 2).join('/') || file.path);
        break;
      }
    }
    if (modules.size >= 5) break;
  }

  return Array.from(modules);
}

/**
 * Reduce a repository or plan context string to a compact form suitable for step prompts.
 *
 * When the input exceeds `maxChars`, the result is a short header followed by up to 15
 * list-style lines (lines starting with `* ` or `- `) if present; otherwise a truncated
 * snippet of the original text with an explicit truncation marker.
 *
 * @param raw - The original repository or plan context text
 * @param maxChars - Maximum allowed characters for the output (default: 2000)
 * @returns A compressed context string no longer than `maxChars` that preserves list-like path lines when available, or a truncated snippet with a header and truncation marker otherwise
 */
export function compressRepositoryContext(raw: string, maxChars = 2_000): string {
  if (raw.length <= maxChars) return raw;

  const fileLines = raw
    .split('\n')
    .filter((l) => l.trim().startsWith('* ') || l.trim().startsWith('- '))
    .slice(0, 15);

  const header = '## Compressed repository context (paths only)\n';
  const body   = fileLines.length > 0
    ? fileLines.join('\n')
    : raw.slice(0, maxChars - 40) + '\n…[truncated]';

  return header + body;
}
