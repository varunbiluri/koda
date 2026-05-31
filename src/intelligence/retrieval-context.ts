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
 * Build a paths + symbols bootstrap from retrieval hits.
 * No code excerpts — exploration happens via tools.
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

/** Heuristic: modules whose path segments overlap query terms. */
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

/** Compress plan/repository context blocks injected into step prompts. */
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
