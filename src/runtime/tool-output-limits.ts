/**
 * Tool output size limits for injection into LLM context.
 *
 * Reference-first tools (read/explore/exec) inject compact refs above
 * INLINE_THRESHOLD. Other tools use LARGE_OUTPUT_THRESHOLD.
 *
 * Full outputs are stored in ToolResultIndex; the LLM fetches via get_tool_result.
 */

/** Chars below which reference-first tools stay inline (errors, tiny outputs). */
export const MIN_INLINE_CHARS = 200;

/** Reference-first tools use refs at or above this size (aggressive context savings). */
export const INLINE_THRESHOLD = MIN_INLINE_CHARS;

/** Legacy threshold for tools not in REFERENCE_FIRST_TOOLS. */
export const LARGE_OUTPUT_THRESHOLD = 5_000;

/** Preview length in ref injection lines. */
export const PREVIEW_CHARS = 120;

/** Tools that prefer reference-first injection to save context. */
export const REFERENCE_FIRST_TOOLS = new Set([
  'read_file',
  'grep_code',
  'search_code',
  'search_files',
  'list_files',
  'list_directory',
  'git_diff',
  'git_log',
  'git_status',
  'run_terminal',
  'fetch_url',
]);

export const TOOL_LIMITS = {
  READ_FILE:    Infinity,
  RUN_TERMINAL: Infinity,
  GIT_DIFF:     Infinity,
  GREP_CODE:    Infinity,
  FETCH_URL:    Infinity,
} as const;
