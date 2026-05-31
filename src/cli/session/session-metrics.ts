import type { ChatMetrics } from '../../ai/reasoning/reasoning-engine.js';
import { ProductMetrics, DEFAULT_KEI_BASELINE_TOKENS } from '../../product/metrics.js';
import { chatMetricsToTelemetry } from '../../product/task-telemetry.js';

/**
 * Persist metrics for a single REPL/CLI turn into the ProductMetrics v2 store.
 *
 * Attempts to load ProductMetrics from `rootPath`, ensure a KEI baseline is set if missing,
 * record a task start/complete with the provided metadata and telemetry derived from `metrics`,
 * then flush the store. Failures during persistence are suppressed and do not propagate.
 *
 * @param rootPath - Filesystem path used to load the ProductMetrics instance
 * @param kind - Task category (one of 'chat', 'fix', 'add', 'auto', 'other')
 * @param description - Human-readable task description stored with the metric
 * @param success - Whether the task completed successfully
 * @param route - Route identifier to include in telemetry
 * @param metrics - Chat metrics (must include `duration` in seconds) used to build telemetry and durationMs
 */
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
