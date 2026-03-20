/**
 * ImpactAnalyzer — pre-write change impact assessment.
 *
 * Before Koda writes a file, ImpactAnalyzer checks how many other files
 * import it and categorises the change as LOW / MEDIUM / HIGH impact.
 *
 * - LOW    (0–2 dependents)  → proceed silently
 * - MEDIUM (3–9 dependents)  → log an INFO warning to the stage stream
 * - HIGH   (10+ dependents)  → log a WARN; suggest running tests first
 *
 * Called from the `onDiff` callback path in `conversation-engine.ts` so
 * the user sees impact context alongside the diff preview.
 *
 * Usage:
 * ```ts
 * const analyzer = new ImpactAnalyzer(rootPath, graph);
 * const report   = analyzer.analyze('src/auth/auth-service.ts');
 * if (report.level !== 'LOW') {
 *   ui.stream(analyzer.formatWarning(report));
 * }
 * ```
 */

import type { RepoGraph, ImpactReport } from './repo-graph.js';

// ── ImpactAnalyzer ─────────────────────────────────────────────────────────────

export class ImpactAnalyzer {
  constructor(
    private readonly rootPath: string,
    private readonly graph:    RepoGraph,
  ) {}

  /**
   * Analyse the impact of changing one or more files.
   */
  analyze(filePaths: string | string[]): ImpactReport {
    const files = Array.isArray(filePaths) ? filePaths : [filePaths];
    // Strip rootPath prefix if present
    const normalized = files.map((f) =>
      f.startsWith(this.rootPath) ? f.slice(this.rootPath.length + 1) : f,
    );
    return this.graph.impactReport(normalized);
  }

  /**
   * Return a formatted one-line warning suitable for `ui.stream()`.
   * Returns empty string for LOW-impact changes (no noise).
   */
  formatWarning(report: ImpactReport): string {
    if (report.level === 'LOW') return '';
    const prefix  = report.level === 'HIGH' ? 'WARN' : 'INFO';
    const emoji   = report.level === 'HIGH' ? '🔴' : '🟡';
    return `${prefix} IMPACT: ${emoji} ${report.summary}`;
  }

  /**
   * Return a formatted multi-line block showing affected files.
   * Use for diff previews when impact ≥ MEDIUM.
   */
  formatBlock(report: ImpactReport): string {
    if (report.level === 'LOW' || report.affectedCount === 0) return '';
    const lines = [this.formatWarning(report)];
    const preview = report.affectedFiles.slice(0, 6);
    for (const f of preview) lines.push(`  · ${f}`);
    if (report.affectedCount > 6) {
      lines.push(`  · … and ${report.affectedCount - 6} more`);
    }
    return lines.join('\n');
  }
}
