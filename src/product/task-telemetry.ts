import type { ChatMetrics } from '../ai/reasoning/reasoning-engine.js';
import type { TaskTelemetry } from './metrics.js';

/**
 * Merge two ChatMetrics objects into a single aggregated ChatMetrics.
 *
 * Produces a metrics object that sums count/token/duration fields, takes the greater
 * context peak, prefers values from `next` for route/provider/model/diffAccepted when present,
 * accumulates diff counters, and computes `refRate` as `toolResultsViaRef / toolResultsTotal`
 * (or `0` when total is `0`).
 *
 * @param acc - The accumulated metrics to merge into.
 * @param next - The next/most-recent metrics to merge, which take precedence for selected fields.
 * @returns A new ChatMetrics object representing the merged/aggregated metrics.
 */
export function mergeChatMetrics(acc: ChatMetrics, next: ChatMetrics): ChatMetrics {
  const toolResultsTotal = acc.toolResultsTotal + next.toolResultsTotal;
  const toolResultsViaRef = acc.toolResultsViaRef + next.toolResultsViaRef;

  return {
    tools:               acc.tools + next.tools,
    tokens:              acc.tokens + next.tokens,
    promptTokens:        acc.promptTokens + next.promptTokens,
    completionTokens:    acc.completionTokens + next.completionTokens,
    duration:            acc.duration + next.duration,
    toolResultsTotal,
    toolResultsViaRef,
    refRate:             toolResultsTotal > 0 ? toolResultsViaRef / toolResultsTotal : 0,
    contextPeakChars:    Math.max(acc.contextPeakChars, next.contextPeakChars),
    route:               next.route ?? acc.route,
    provider:            next.provider ?? acc.provider,
    model:               next.model ?? acc.model,
    diffAccepted:        next.diffAccepted ?? acc.diffAccepted,
    diffRejected:        (acc.diffRejected ?? 0) + (next.diffRejected ?? 0),
    diffApproved:        (acc.diffApproved ?? 0) + (next.diffApproved ?? 0),
  };
}

/**
 * Create an empty ChatMetrics object with all numeric fields initialized to zero.
 *
 * @returns A `ChatMetrics` object where `tools`, `tokens`, `promptTokens`, `completionTokens`, `duration`,
 * `toolResultsTotal`, `toolResultsViaRef`, `refRate`, and `contextPeakChars` are all `0`.
 */
export function emptyChatMetrics(): ChatMetrics {
  return {
    tools:               0,
    tokens:              0,
    promptTokens:        0,
    completionTokens:    0,
    duration:            0,
    toolResultsTotal:    0,
    toolResultsViaRef:   0,
    refRate:             0,
    contextPeakChars:    0,
  };
}

/**
 * Map chat metrics into a TaskTelemetry payload for telemetry emission.
 *
 * @param m - The chat metrics to convert; `provider` and `model` default to `'unknown'` when absent.
 * @returns A `TaskTelemetry` object containing `provider`, `model`, token counts (`promptTokens`, `completionTokens`), `toolCalls`, reference metrics (`refRate`, `toolResultsTotal`, `toolResultsViaRef`), `route`, `diffAccepted`, and `contextPeakChars`.
 */
export function chatMetricsToTelemetry(m: ChatMetrics): TaskTelemetry {
  return {
    provider:            m.provider ?? 'unknown',
    model:               m.model ?? 'unknown',
    promptTokens:        m.promptTokens,
    completionTokens:    m.completionTokens,
    toolCalls:           m.tools,
    refRate:             m.refRate,
    toolResultsTotal:    m.toolResultsTotal,
    toolResultsViaRef:   m.toolResultsViaRef,
    route:               m.route,
    diffAccepted:        m.diffAccepted,
    contextPeakChars:    m.contextPeakChars,
  };
}

/**
 * Computes the KEI as 100 × (baseline median tokens / agent median tokens).
 *
 * @param baselineMedianTokens - Median token count for the baseline
 * @param agentMedianTokens - Median token count for the agent
 * @returns The KEI rounded to the nearest integer; returns 0 if either median is less than or equal to 0
 */
export function computeKei(baselineMedianTokens: number, agentMedianTokens: number): number {
  if (agentMedianTokens <= 0 || baselineMedianTokens <= 0) return 0;
  return Math.round(100 * (baselineMedianTokens / agentMedianTokens));
}

/**
 * Compute the median of an array of numbers.
 *
 * @param values - Array of numeric values
 * @returns The median value; returns `0` if `values` is empty. For odd-length arrays the middle element is returned, and for even-length arrays the arithmetic mean of the two middle elements is returned.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}
