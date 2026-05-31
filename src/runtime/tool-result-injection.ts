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

/**
 * Produce the message text to inject into LLM history for a tool result, choosing between inline content and a reference-style summary.
 *
 * When `opts.cacheHit` is true or the output meets configured size thresholds, the function returns a brief reference summary (with `viaRef: true`); otherwise it returns the full result inline. Error-shaped outputs (starting with `Error:` or `Error (`) are always returned inline.
 *
 * @param toolName - The tool's name used in the injected header when a reference summary is produced.
 * @param result - The raw tool output to inject or summarize.
 * @param storedId - Identifier used in reference-style summaries to point to stored results.
 * @param opts.cacheHit - If true, force a reference-style summary and mark the summary as cached.
 * @param opts.repetitionHint - Optional string appended to the injected content (e.g., a hint about repeated content).
 * @returns The injection payload: `content` is the text to insert into the LLM history; `viaRef` is `true` when a reference-style summary is used, `false` when the full `result` is inlined.
 */
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

/**
 * Decides whether a tool output should be injected as a reference based on configured thresholds.
 *
 * @param toolName - The tool's identifier; tools listed as reference-first use a lower threshold.
 * @param resultLength - The length in characters of the tool output.
 * @returns `true` if `resultLength` meets or exceeds the threshold that requires reference injection for the given tool, `false` otherwise.
 */
export function shouldUseReference(toolName: string, resultLength: number): boolean {
  if (REFERENCE_FIRST_TOOLS.has(toolName)) {
    return resultLength >= INLINE_THRESHOLD;
  }
  return resultLength >= LARGE_OUTPUT_THRESHOLD;
}
