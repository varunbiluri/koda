/**
 * PromptSplit — separates static (cacheable) from dynamic (per-turn) system content.
 *
 * Static block: identity, tool policy, exploration order — stable across turns.
 * Dynamic block: repo metadata, retrieval bootstrap, AGENTS.md, workspace memory.
 */

import type { ChatContext } from '../reasoning/reasoning-engine.js';
import type { ProjectDependencies } from '../../analysis/dependency-detector.js';

/** Stable system prefix — suitable for provider prompt caching. */
export const STATIC_SYSTEM_CORE = [
  'You are Koda — an autonomous AI software engineer.',
  '',
  'Tool policy:',
  '• Explore with search_files and grep_code before read_file',
  '• read_file supports optional startLine/endLine for partial reads',
  '• Tool outputs are reference-first — use get_tool_result(ref) for full content',
  '• Prefer edit_file over write_file for existing files',
  '• Never run destructive shell commands (rm -rf, git reset --hard, DROP TABLE)',
  '',
  'Response style: concise, technical, evidence-based.',
].join('\n');

export interface DynamicPromptInput {
  ctx:               ChatContext;
  retrievalBlock?:   string;
  agentsMd?:         string;
  deps?:              ProjectDependencies | null;
  workspaceContext?: string;
}

/** Per-turn dynamic system suffix. */
export function buildDynamicSystemBlock(input: DynamicPromptInput): string {
  const { ctx, retrievalBlock, agentsMd, deps, workspaceContext } = input;
  const parts: string[] = [
    '',
    `Repository: ${ctx.repoName}`,
    `Branch:     ${ctx.branch}`,
    `Directory:  ${ctx.rootPath}`,
    `Files indexed: ${ctx.fileCount}`,
  ];

  if (deps && deps.language !== 'unknown') {
    parts.push('', '## Stack', '');
    parts.push(`Language: ${deps.language}`);
    if (deps.framework)     parts.push(`Framework: ${deps.framework}`);
    if (deps.testFramework) parts.push(`Tests: ${deps.testFramework}`);
    if (deps.buildTool)     parts.push(`Build: ${deps.buildTool}`);
  }

  if (agentsMd) {
    parts.push('', '## AGENTS.md', '', agentsMd.slice(0, 4_000));
  }
  if (workspaceContext) parts.push(workspaceContext);
  if (retrievalBlock) parts.push(retrievalBlock);

  return parts.join('\n');
}

export function buildSplitSystemPrompt(input: DynamicPromptInput): string {
  return STATIC_SYSTEM_CORE + buildDynamicSystemBlock(input);
}
