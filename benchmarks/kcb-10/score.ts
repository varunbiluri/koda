import { computeKei, median } from '../../src/product/task-telemetry.js';

export interface KcbTaskResult {
  taskId:              string;
  kind:                string;
  success:             boolean;
  promptTokens:        number;
  completionTokens:    number;
  toolCalls:           number;
  refRate:             number;
  toolResultsTotal:    number;
  toolResultsViaRef:   number;
}

export interface KcbScorecard {
  version:              string;
  runAt:                string;
  taskCount:            number;
  successRate:          number;
  medianTokens:         number;
  medianPromptTokens:   number;
  medianRefRate:        number;
  kei:                  number;
  baselineMedianTokens: number;
  results:              KcbTaskResult[];
  note?:                string;
}

export function scoreResults(
  results: KcbTaskResult[],
  opts: { version: string; baselineMedianTokens: number },
): KcbScorecard {
  const totals = results.map((r) => r.promptTokens + r.completionTokens);
  const medianTokens = median(totals);
  const successCount = results.filter((r) => r.success).length;

  return {
    version:              opts.version,
    runAt:                new Date().toISOString(),
    taskCount:            results.length,
    successRate:          results.length > 0 ? successCount / results.length : 0,
    medianTokens,
    medianPromptTokens:   median(results.map((r) => r.promptTokens)),
    medianRefRate:        median(results.map((r) => r.refRate)),
    kei:                  computeKei(opts.baselineMedianTokens, medianTokens),
    baselineMedianTokens: opts.baselineMedianTokens,
    results,
  };
}
