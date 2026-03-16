/**
 * Tool output size limits (in characters).
 *
 * Applied by ToolRegistry before returning results to the AI to prevent
 * individual tool calls from contributing excessive tokens to the prompt.
 */

export const TOOL_OUTPUT_LIMITS = {
  READ_FILE:      3_000,
  RUN_TERMINAL:   4_000,
  GIT_DIFF:       6_000,
  GREP_CODE:      4_000,
  FETCH_URL:      6_000,
  LIST_DIRECTORY: 2_000,
} as const;

/**
 * Truncate a tool output string to at most `limit` characters.
 * Appends a hint suffix so the AI understands why the output was cut.
 */
export function truncateOutput(output: string, limit: number, hint = ''): string {
  if (output.length <= limit) return output;
  const suffix = hint
    ? `\n\n[output truncated — ${hint}]`
    : '\n\n[output truncated]';
  return output.slice(0, limit) + suffix;
}
