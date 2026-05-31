import type { ChatMetrics } from '../../ai/reasoning/reasoning-engine.js';
import { ProductMetrics, DEFAULT_KEI_BASELINE_TOKENS } from '../../product/metrics.js';
import { chatMetricsToTelemetry } from '../../product/task-telemetry.js';

/** Persist one REPL/CLI turn to ProductMetrics v2. */
export async function persistTurnMetrics(
  rootPath: string,
  kind:     'chat' | 'fix' | 'add' | 'auto' | 'other',
  description: string,
  success:  boolean,
  route:    string,
  metrics:  ChatMetrics,
): Promise<void> {
  try {
    const pm = await ProductMetrics.load(rootPath);
    if (!pm.getStore().keiBaselineMedianTokens) {
      pm.setKeiBaseline(DEFAULT_KEI_BASELINE_TOKENS);
    }
    pm.taskStart(kind, description);
    pm.taskComplete({
      success,
      retries: 0,
      durationMs: metrics.duration * 1000,
      telemetry: {
        ...chatMetricsToTelemetry(metrics),
        route,
      },
    });
    await pm.flush();
  } catch {
    // non-fatal
  }
}
