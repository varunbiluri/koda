/**
 * Tool output size limits for injection into LLM context.
 *
 * In the final architecture, tools themselves are unbounded — they can
 * stream and store arbitrarily large outputs via ToolResultIndex. The
 * LLM sees only compact references, not raw data, so these limits are
 * expressed as Infinity to signal "no per-call truncation at the tool
 * boundary".
 *
 * Context is bounded later via trimContext(), not here.
 */
export const TOOL_LIMITS = {
  READ_FILE:   Infinity,
  RUN_TERMINAL: Infinity,
  GIT_DIFF:    Infinity,
  GREP_CODE:   Infinity,
  FETCH_URL:   Infinity,
} as const;
