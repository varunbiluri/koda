/**
 * Tool result injection — reference-first strategy for LLM context efficiency.
 *
 * Small errors stay inline. Read/explore tools use refs above INLINE_THRESHOLD.
 * Cache hits always inject a ref (never re-inline stored bodies).
 */

import {
  INLINE_THRESHOLD,
  LARGE_OUTPUT_THRESHOLD,
  PREVIEW_CHARS,
  REFERENCE_FIRST_TOOLS,
} from './tool-output-limits.js';

export interface ToolInjectionResult {
  content: string;
  viaRef: boolean;
}

/** Build the tool-role message content injected into the LLM history. */
export function buildToolResultInjection(
  toolName: string,
  result: string,
  storedId: string,
  opts: { cacheHit?: boolean; repetitionHint?: string } = {},
): ToolInjectionResult {
  const hint = opts.repetitionHint ?? '';

  if (result.startsWith('Error:') || result.startsWith('Error (')) {
    return { content: result + hint, viaRef: false };
  }

  const useRef =
    opts.cacheHit === true ||
    shouldUseReference(toolName, result.length);

  if (!useRef) {
    return { content: result + hint, viaRef: false };
  }

  const lineCount = result.split('\n').length;
  const preview   = result.slice(0, PREVIEW_CHARS);
  const argHint   = REFERENCE_FIRST_TOOLS.has(toolName)
    ? 'Use get_tool_result to fetch sections, or grep_code to search within the output.'
    : 'Use get_tool_result or grep_code to retrieve specific sections.';

  const content =
    `[${storedId}] ${toolName} → ${lineCount} lines (${result.length} chars)` +
    (opts.cacheHit ? ' [cached]' : '') +
    `\nPreview: ${preview}${result.length > PREVIEW_CHARS ? '…' : ''}\n` +
    `${argHint}${hint}`;

  return { content, viaRef: true };
}

export function shouldUseReference(toolName: string, resultLength: number): boolean {
  if (REFERENCE_FIRST_TOOLS.has(toolName)) {
    return resultLength >= INLINE_THRESHOLD;
  }
  return resultLength >= LARGE_OUTPUT_THRESHOLD;
}
