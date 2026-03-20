/**
 * Tool output size limits for injection into LLM context.
 *
 * Tools themselves are unbounded — they can produce arbitrarily large outputs
 * which are stored in ToolResultIndex.  What the LLM actually receives is
 * determined by the HYBRID STRATEGY in ReasoningEngine.chat():
 *
 *   output < INLINE_THRESHOLD (5 000 chars)
 *     → injected directly into the message history (fast path, no overhead)
 *
 *   output ≥ INLINE_THRESHOLD
 *     → stored as a ToolResultIndex reference; LLM receives a compact header +
 *       500-char preview.  Use grep_code / search_code to retrieve sections.
 *
 * TOOL_LIMITS entries are kept at Infinity to signal "no per-call truncation
 * at the tool boundary".  The threshold enforcement happens in the reasoning
 * engine, not here.
 */

/** Characters below which a tool result is injected inline into the LLM prompt. */
export const INLINE_THRESHOLD = 5_000;

export const TOOL_LIMITS = {
  READ_FILE:    Infinity,
  RUN_TERMINAL: Infinity,
  GIT_DIFF:     Infinity,
  GREP_CODE:    Infinity,
  FETCH_URL:    Infinity,
} as const;
