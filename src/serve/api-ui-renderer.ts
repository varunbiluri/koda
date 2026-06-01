import type { Ora } from 'ora';
import type { ChatMetrics } from '../ai/reasoning/reasoning-engine.js';
import type { ExecutionPlan } from '../ai/reasoning/planning-engine.js';
import type { ExecutionMetrics } from '../execution/plan-executor.js';
import type { FilePatch } from '../patch/types.js';
import { UIRenderer } from '../cli/session/ui-renderer.js';
import { diffStats, parseToolStage } from './stage-parser.js';
import type { ServeEvent } from './types.js';

/**
 * Headless UI renderer for `koda serve`.
 * Emits structured tool cards + terminal lines for the desktop command center.
 */
export class ApiUIRenderer extends UIRenderer {
  private planSteps: string[] = [];
  private planActive = 0;

  constructor(private readonly emit: (event: ServeEvent) => void) {
    super();
  }

  override renderHeader(): void { /* no-op */ }
  override renderWelcome(): void { /* no-op */ }
  override renderPrompt(): void { /* no-op */ }

  override renderThinking(): Ora {
    this.emit({ type: 'thinking' });
    return { isSpinning: false, stop: () => undefined, succeed: () => undefined, fail: () => undefined } as unknown as Ora;
  }

  override stopSpinner(success = true, message?: string): void {
    if (!success && message) {
      this.emit({ type: 'error', message });
    }
  }

  override renderStreamChunk(chunk: string): void {
    this.emit({ type: 'token', text: chunk });
  }

  override renderStreamEnd(): void { /* no-op */ }

  override stream(raw: string): void {
    const parsed = parseToolStage(raw);
    if (parsed.isTool) {
      this.emit({ type: 'tool', kind: parsed.kind, detail: parsed.detail });
    } else {
      this.emit({ type: 'terminal', line: raw });
    }
  }

  override renderPlan(steps: string[]): void {
    this.planSteps = [...steps];
    this.planActive = 0;
    this.setLastPlan(steps);
    this.emit({ type: 'plan', steps, activeStep: 0 });
  }

  override renderExecutionPlan(plan: ExecutionPlan): void {
    const steps = plan.steps.map((s) => s.description);
    this.renderPlan(steps);
    super.renderExecutionPlan(plan);
  }

  override advancePlan(): void {
    super.advancePlan();
    this.planActive = Math.min(this.planActive + 1, Math.max(0, this.planSteps.length - 1));
    if (this.planSteps.length > 0) {
      this.emit({ type: 'plan', steps: this.planSteps, activeStep: this.planActive });
    }
  }

  override renderContext(files: string[], tokens: number): void {
    this.emit({ type: 'context', files, tokens });
  }

  emitRichContext(
    files: string[],
    tokens: number,
    meta: { fileCount?: number; chunkCount?: number; symbolCount?: number; refs?: number },
  ): void {
    this.emit({ type: 'context', files, tokens, ...meta });
  }

  override renderTimeline(entries: Array<{ name: string; durationMs: number }>): void {
    for (const entry of entries) {
      const parsed = parseToolStage(entry.name);
      this.emit({
        type: 'tool',
        kind: parsed.isTool ? parsed.kind : 'INFO',
        detail: parsed.detail || entry.name,
        durationMs: entry.durationMs,
      });
    }
    this.emit({ type: 'timeline', entries });
  }

  override renderDiffPreview(filePath: string, oldContent: string, newContent: string): void {
    const { added, removed } = diffStats(oldContent, newContent);
    this.emit({ type: 'diff', filePath, oldContent, newContent, added, removed });
  }

  override renderError(message: string, suggestion?: string): void {
    this.emit({ type: 'error', message, suggestion });
  }

  override renderInfo(message: string): void {
    this.emit({ type: 'info', message });
  }

  override renderHelp(): void {
    this.emit({ type: 'info', message: 'Use POST /api/chat with a message body.' });
  }

  override renderExecutionSummary(metrics: ChatMetrics): void {
    this.recordChatMetrics(metrics);
  }

  override dagStart(nodes: Array<{ id: string; description: string }>): void {
    super.dagStart(nodes);
    this.emit({ type: 'terminal', line: `GRAPH ${nodes.length} nodes` });
  }

  override dagNodeStart(nodeId: string): void {
    super.dagNodeStart(nodeId);
    this.emit({ type: 'terminal', line: `NODE start ${nodeId}` });
  }

  override dagNodeDone(nodeId: string, durationMs: number): void {
    super.dagNodeDone(nodeId, durationMs);
    this.emit({ type: 'tool', kind: 'RUN', detail: nodeId, durationMs });
  }

  override dagNodeFailed(nodeId: string): void {
    super.dagNodeFailed(nodeId);
    this.emit({ type: 'terminal', line: `NODE failed ${nodeId}` });
  }

  override renderCompletionSummary(_opts: {
    status: 'ok' | 'failed';
    stepsOrNodes: number;
    toolCalls: number;
    durationMs: number;
    filesChanged: string[];
  }): void { /* no-op */ }

  override renderFeatureExecutionSummary(
    _metrics: Omit<ExecutionMetrics, 'verificationStatus'> & { verificationStatus: string },
  ): void { /* no-op */ }

  override renderPatchPreview(_patches: FilePatch[]): void { /* no-op */ }
  override renderSmartSuggestions(): void { /* no-op */ }
}
