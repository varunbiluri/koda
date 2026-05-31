import type { ChatMetrics } from '../ai/reasoning/reasoning-engine.js';
import type { TaskTelemetry } from './metrics.js';

/** Merge chat() metrics from multiple iterations (fix/add/auto loops). */
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

/** KEI = 100 × (baseline_median_tokens / agent_median_tokens) */
export function computeKei(baselineMedianTokens: number, agentMedianTokens: number): number {
  if (agentMedianTokens <= 0 || baselineMedianTokens <= 0) return 0;
  return Math.round(100 * (baselineMedianTokens / agentMedianTokens));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}
