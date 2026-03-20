/**
 * TaskMemoryStore — per-execution short-term memory for Koda.
 *
 * Distinct from WorkspaceIntelligence (cross-session persistence) and from
 * chat history (which Koda intentionally does not accumulate).  TaskMemoryStore
 * captures structured facts about what happened during the current task:
 *
 *   - Files touched (so follow-up tasks know what changed)
 *   - Decisions made (so the next node / follow-up can build on them)
 *   - Errors encountered (so retry logic can avoid the same mistake)
 *
 * Lifecycle:
 *   One TaskMemoryStore per conversation turn.  Created in ConversationEngine,
 *   serialised into the follow-up task prompt via formatForNextTask(), discarded
 *   when the session ends.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TaskDecision {
  /** Short label for where the decision was made (e.g. "explore_repo"). */
  step:      string;
  /** What was decided (e.g. "auth logic lives in src/auth/auth-service.ts"). */
  decision:  string;
  timestamp: number;
}

export interface TaskError {
  /** Tool or node that produced this error. */
  tool:      string;
  /** Trimmed error text (≤ 300 chars). */
  error:     string;
  timestamp: number;
}

// ── TaskMemoryStore ────────────────────────────────────────────────────────────

/**
 * Accumulates facts about the current task execution.
 *
 * All writes are in-memory only; nothing is persisted to disk here —
 * WorkspaceIntelligence handles long-term persistence.
 */
export class TaskMemoryStore {
  private readonly _filesTouched = new Set<string>();
  private readonly _decisions:    TaskDecision[] = [];
  private readonly _errors:       TaskError[]    = [];
  private readonly startTime = Date.now();

  // ── Write ──────────────────────────────────────────────────────────────────

  recordFileTouched(filePath: string): void {
    this._filesTouched.add(filePath);
  }

  recordDecision(step: string, decision: string): void {
    this._decisions.push({ step, decision, timestamp: Date.now() });
  }

  recordError(tool: string, error: string): void {
    this._errors.push({ tool, error: error.slice(0, 300), timestamp: Date.now() });
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  get filesTouched(): string[]      { return Array.from(this._filesTouched); }
  get decisions():    TaskDecision[] { return this._decisions; }
  get errors():       TaskError[]    { return this._errors; }
  get elapsedMs():    number         { return Date.now() - this.startTime; }

  isEmpty(): boolean {
    return this._filesTouched.size === 0 &&
           this._decisions.length  === 0 &&
           this._errors.length     === 0;
  }

  // ── Serialisation ──────────────────────────────────────────────────────────

  /**
   * Format this memory as a markdown block for injection at the top of a
   * follow-up task's system prompt.
   *
   * Callers should include this only when the store is non-empty:
   * ```ts
   * if (!taskMemory.isEmpty()) {
   *   systemPrompt += '\n\n' + taskMemory.formatForNextTask();
   * }
   * ```
   */
  formatForNextTask(): string {
    const lines: string[] = ['## Context from previous task', ''];

    if (this._filesTouched.size > 0) {
      lines.push(
        `**Files modified:** ${Array.from(this._filesTouched).join(', ')}`,
      );
      lines.push('');
    }

    if (this._decisions.length > 0) {
      lines.push('**Key decisions made:**');
      this._decisions.slice(-6).forEach((d) => {
        lines.push(`- [${d.step}] ${d.decision}`);
      });
      lines.push('');
    }

    if (this._errors.length > 0) {
      lines.push('**Errors encountered (do not repeat these mistakes):**');
      this._errors.slice(-4).forEach((e) => {
        lines.push(`- ${e.tool}: ${e.error}`);
      });
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  /**
   * Compact one-line summary for display in the terminal.
   */
  formatSummary(): string {
    const parts: string[] = [];
    if (this._filesTouched.size > 0)
      parts.push(`${this._filesTouched.size} file${this._filesTouched.size !== 1 ? 's' : ''} touched`);
    if (this._decisions.length > 0)
      parts.push(`${this._decisions.length} decision${this._decisions.length !== 1 ? 's' : ''}`);
    if (this._errors.length > 0)
      parts.push(`${this._errors.length} error${this._errors.length !== 1 ? 's' : ''}`);
    return parts.length > 0 ? parts.join(' · ') : 'no activity';
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  reset(): void {
    this._filesTouched.clear();
    this._decisions.length = 0;
    this._errors.length    = 0;
  }
}
