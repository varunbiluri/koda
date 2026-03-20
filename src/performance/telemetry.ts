/**
 * Telemetry — per-node execution timing and performance reporting.
 *
 * Collects:
 *   - Per-node wall-clock time (start → complete)
 *   - Per-tool-call latency histogram
 *   - LLM call latency (time-to-first-token, total duration)
 *   - Retry count per node
 *   - Overall session summary
 *
 * Non-invasive: telemetry calls are always sync and non-blocking.
 * Zero overhead when disabled.
 *
 * Usage:
 * ```ts
 * const t = new Telemetry({ enabled: true });
 * t.nodeStart('plan_auth');
 * t.toolCall('read_file', 'src/auth.ts', 42);
 * t.llmCall(800, 2_100); // ttft_ms, total_ms
 * t.nodeEnd('plan_auth', { success: true });
 * console.log(t.formatReport());
 * ```
 */

import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface NodeTiming {
  nodeId:     string;
  startMs:    number;
  endMs:      number;
  durationMs: number;
  success:    boolean;
  retries:    number;
}

export interface ToolTiming {
  tool:       string;
  target:     string;
  durationMs: number;
}

export interface LLMTiming {
  ttftMs:     number; // time-to-first-token
  totalMs:    number;
  nodeId:     string;
}

export interface TelemetryReport {
  sessionDurationMs: number;
  nodeTimings:       NodeTiming[];
  toolTimings:       ToolTiming[];
  llmTimings:        LLMTiming[];
  totalLLMMs:        number;
  totalToolMs:       number;
  slowestNode:       NodeTiming | null;
  slowestTool:       ToolTiming | null;
}

// ── Telemetry ──────────────────────────────────────────────────────────────────

export class Telemetry {
  private readonly enabled: boolean;
  private readonly sessionStart: number;
  private readonly nodes:  Map<string, Partial<NodeTiming>> = new Map();
  private readonly tools:  ToolTiming[]  = [];
  private readonly llms:   LLMTiming[]   = [];
  private currentNodeId: string | null   = null;

  constructor(opts: { enabled?: boolean } = {}) {
    this.enabled      = opts.enabled ?? true;
    this.sessionStart = Date.now();
  }

  // ── Node lifecycle ─────────────────────────────────────────────────────────

  nodeStart(nodeId: string): void {
    if (!this.enabled) return;
    this.currentNodeId = nodeId;
    this.nodes.set(nodeId, { nodeId, startMs: Date.now(), retries: 0 });
  }

  nodeEnd(nodeId: string, opts: { success: boolean; retries?: number }): void {
    if (!this.enabled) return;
    const entry = this.nodes.get(nodeId);
    if (!entry || entry.startMs === undefined) return;
    const endMs      = Date.now();
    const durationMs = endMs - entry.startMs;
    this.nodes.set(nodeId, {
      ...entry,
      endMs,
      durationMs,
      success:  opts.success,
      retries:  opts.retries ?? entry.retries ?? 0,
    } as NodeTiming);
    logger.debug(`[telemetry] Node ${nodeId}: ${durationMs}ms, success=${opts.success}`);
  }

  nodeRetry(nodeId: string): void {
    if (!this.enabled) return;
    const entry = this.nodes.get(nodeId);
    if (entry) {
      entry.retries = (entry.retries ?? 0) + 1;
    }
  }

  // ── Tool tracking ──────────────────────────────────────────────────────────

  toolCall(tool: string, target: string, durationMs: number): void {
    if (!this.enabled) return;
    this.tools.push({ tool, target, durationMs });
    logger.debug(`[telemetry] Tool ${tool}(${target}): ${durationMs}ms`);
  }

  // ── LLM tracking ──────────────────────────────────────────────────────────

  llmCall(ttftMs: number, totalMs: number): void {
    if (!this.enabled) return;
    const nodeId = this.currentNodeId ?? 'unknown';
    this.llms.push({ ttftMs, totalMs, nodeId });
    logger.debug(`[telemetry] LLM call: ttft=${ttftMs}ms, total=${totalMs}ms`);
  }

  // ── Reporting ──────────────────────────────────────────────────────────────

  getReport(): TelemetryReport {
    const nodeTimings = Array.from(this.nodes.values()).filter(
      (n): n is NodeTiming => n.durationMs !== undefined,
    );

    const totalLLMMs  = this.llms.reduce((s, l) => s + l.totalMs, 0);
    const totalToolMs = this.tools.reduce((s, t) => s + t.durationMs, 0);

    const slowestNode = nodeTimings.reduce<NodeTiming | null>(
      (a, b) => (!a || b.durationMs > a.durationMs ? b : a), null,
    );
    const slowestTool = this.tools.reduce<ToolTiming | null>(
      (a, b) => (!a || b.durationMs > a.durationMs ? b : a), null,
    );

    return {
      sessionDurationMs: Date.now() - this.sessionStart,
      nodeTimings,
      toolTimings: this.tools,
      llmTimings:  this.llms,
      totalLLMMs,
      totalToolMs,
      slowestNode,
      slowestTool,
    };
  }

  formatReport(): string {
    if (!this.enabled) return '';
    const r = this.getReport();

    const lines: string[] = [
      '╔════════════════════════════════════════════',
      '║  Performance Report',
      `╠ Session duration : ${r.sessionDurationMs}ms`,
      `╠ LLM total        : ${r.totalLLMMs}ms (${r.llmTimings.length} calls)`,
      `╠ Tool total       : ${r.totalToolMs}ms (${r.toolTimings.length} calls)`,
    ];

    if (r.slowestNode) {
      lines.push(
        `╠ Slowest node     : ${r.slowestNode.nodeId} — ${r.slowestNode.durationMs}ms` +
        (r.slowestNode.retries > 0 ? ` (${r.slowestNode.retries} retries)` : ''),
      );
    }

    if (r.slowestTool) {
      lines.push(
        `╠ Slowest tool     : ${r.slowestTool.tool}(${r.slowestTool.target.slice(0, 40)}) — ${r.slowestTool.durationMs}ms`,
      );
    }

    if (r.nodeTimings.length > 0) {
      lines.push('╠ Node breakdown:');
      const sorted = [...r.nodeTimings].sort((a, b) => b.durationMs - a.durationMs).slice(0, 8);
      for (const n of sorted) {
        const icon = n.success ? '✓' : '✗';
        const retry = n.retries > 0 ? ` (${n.retries}r)` : '';
        lines.push(`║   ${icon} ${n.nodeId.padEnd(30)} ${n.durationMs}ms${retry}`);
      }
    }

    lines.push('╚════════════════════════════════════════════');
    return lines.join('\n');
  }
}

/** Shared session telemetry instance. */
export const telemetry = new Telemetry({ enabled: true });
