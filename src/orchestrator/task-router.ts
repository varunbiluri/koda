import { logger } from '../utils/logger.js';

// ── Public types ──────────────────────────────────────────────────────────────

export enum TaskComplexity {
  SIMPLE    = 'SIMPLE',
  MEDIUM    = 'MEDIUM',
  COMPLEX   = 'COMPLEX',
  /**
   * DELEGATED — task is too broad for a single agent loop and should be
   * handed to `SupervisorAgent.delegate()`, which splits it into
   * CodingAgent / TestAgent / RefactorAgent / DocumentationAgent subtasks.
   */
  DELEGATED = 'DELEGATED',
}

export interface TaskClassification {
  /** Classified complexity tier. */
  complexity:  TaskComplexity;
  /**
   * Confidence in the classification, in the range [0, 1].
   * Values below 0.6 should trigger a safety fallback to SIMPLE.
   */
  confidence:  number;
  /** Human-readable explanation of why this classification was chosen. */
  reason:      string;
}

// ── Keyword signal tables ─────────────────────────────────────────────────────

/**
 * Patterns that indicate a read-only / exploratory query.
 * A match here adds evidence for SIMPLE.
 */
const SIMPLE_PATTERNS: RegExp[] = [
  /\bexplain\b/i,
  /\bwhat\s+(does|is|are|was)\b/i,
  /\bhow\s+does\b/i,
  /\bhow\s+is\b/i,
  /\bwhy\b/i,
  /\bwhere\s+(is|are|does)\b/i,
  /\bshow\s+(me\s+)?the\b/i,
  /\bfind\b/i,
  /\bdescribe\b/i,
  /\blist\b/i,
  /\btell\s+me\b/i,
  /\bsummar(y|ize|ise)\b/i,
  /\bwalk\s+me\s+through\b/i,
  /\bunderstand\b/i,
  /\boverview\b/i,
];

/**
 * Patterns that indicate a write / engineering change task.
 * A match here adds evidence for MEDIUM or COMPLEX.
 */
const COMPLEX_PATTERNS: RegExp[] = [
  /\bimplement\b/i,
  /\badd\s+\w/i,          // "add X" — avoid matching "add" at end of sentence
  /\bbuild\b/i,
  /\bcreate\b/i,
  /\brefactor\b/i,
  /\brewrite\b/i,
  /\bmigrate\b/i,
  /\boptimize\b/i,
  /\bperformance\s+(improve|fix|optim)/i,
  /\badd\s+tests?\b/i,
  /\bwrite\s+tests?\b/i,
  /\bfix\s+(bug|issue|error|problem|the)\b/i,
  /\bintegrate\b/i,
  /\bsupport\s+\w/i,
  /\bgenerate\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bextract\b/i,
  /\bdeploy\b/i,
  /\bsetup\b/i,
  /\bconfigure\b/i,
];

// ── Confidence constants ───────────────────────────────────────────────────────

/** Confidence thresholds. Values below SAFETY_FLOOR trigger a SIMPLE fallback. */
const SAFETY_FLOOR = 0.60;

const C = {
  HIGH:   0.90,
  MEDIUM: 0.75,
  LOW:    0.62,
  WEAK:   0.55,
} as const;

// ── TaskRouter ────────────────────────────────────────────────────────────────

/**
 * TaskRouter — classifies user queries by complexity without any LLM call.
 *
 * The classifier combines two signals:
 *   1. **Keyword heuristics** — regex patterns for SIMPLE (exploratory) and
 *      COMPLEX (engineering action) intent.
 *   2. **Repository impact estimation** — the number of files returned by the
 *      upstream retrieval pass gives a rough measure of cross-module spread.
 *
 * Both signals are merged via a deterministic decision table to produce a
 * `TaskClassification` with an explicit confidence score.  The caller should
 * fall back to SIMPLE when confidence < 0.6 (the `SAFETY_FLOOR`).
 *
 * @example
 * ```ts
 * const router = new TaskRouter();
 * const cls = router.classify('explain the auth middleware', ['src/auth.ts']);
 * // { complexity: SIMPLE, confidence: 0.90, reason: '…' }
 * ```
 */
export class TaskRouter {
  /** Confidence value below which the caller should override with SIMPLE. */
  static readonly SAFETY_FLOOR = SAFETY_FLOOR;

  /**
   * Classify a user query.
   *
   * @param query          - Raw user input (case-insensitive matching applied internally).
   * @param retrievedFiles - File paths returned by the retrieval layer.  Pass an
   *                         empty array when no index is available.
   */
  classify(query: string, retrievedFiles: string[]): TaskClassification {
    const hasSimple  = SIMPLE_PATTERNS.some((p)  => p.test(query));
    const hasComplex = COMPLEX_PATTERNS.some((p) => p.test(query));
    const fileCount  = retrievedFiles.length;

    logger.debug(
      `[task-router] signals: simple=${hasSimple} complex=${hasComplex} files=${fileCount}`,
    );

    // ── Decision table (priority top-to-bottom) ────────────────────────────

    // DELEGATED: multi-role tasks (implement + test, or refactor + document)
    // detected by presence of multiple distinct complex-action categories
    if (hasComplex) {
      const lower = query.toLowerCase();
      const hasImpl    = /\b(implement|build|create|add|write)\b/.test(lower);
      const hasTest    = /\b(test|spec|tdd|coverage)\b/.test(lower);
      const hasRefac   = /\b(refactor|clean|restructure)\b/.test(lower);
      const hasDoc     = /\b(document|jsdoc|readme)\b/.test(lower);
      const roleCount  = [hasImpl, hasTest, hasRefac, hasDoc].filter(Boolean).length;

      if (roleCount >= 2 || (fileCount > 8 && hasComplex)) {
        return this._result(TaskComplexity.DELEGATED, C.HIGH,
          `Multi-role task (${roleCount} specialisations detected) or broad impact (${fileCount} files) — routing to supervisor agent`);
      }
    }

    // Both signals: action verbs outweigh questions — lean COMPLEX/MEDIUM
    if (hasSimple && hasComplex) {
      if (fileCount > 5) {
        return this._result(TaskComplexity.COMPLEX, C.MEDIUM,
          `Mixed intent (action + exploratory); ${fileCount} files — broad impact`);
      }
      if (fileCount > 2) {
        return this._result(TaskComplexity.MEDIUM, C.LOW,
          `Mixed intent; ${fileCount} files touched`);
      }
      return this._result(TaskComplexity.MEDIUM, C.LOW,
        'Mixed action/query intent; minimal file spread');
    }

    // Clear COMPLEX keyword signal
    if (hasComplex) {
      if (fileCount > 5) {
        return this._result(TaskComplexity.COMPLEX, C.HIGH,
          `Engineering action keyword + ${fileCount} files (multi-module change)`);
      }
      if (fileCount > 2) {
        return this._result(TaskComplexity.MEDIUM, C.MEDIUM,
          `Engineering action + ${fileCount} files`);
      }
      return this._result(TaskComplexity.MEDIUM, C.LOW,
        `Engineering action keyword, limited file spread (${fileCount})`);
    }

    // Clear SIMPLE keyword signal
    if (hasSimple) {
      if (fileCount > 5) {
        // Many files but clearly exploratory — still SIMPLE (user is reading)
        return this._result(TaskComplexity.SIMPLE, C.LOW,
          `Exploratory query touching ${fileCount} files`);
      }
      return this._result(TaskComplexity.SIMPLE, C.HIGH,
        `Exploratory query with ${fileCount} file(s)`);
    }

    // No keyword match — use file count alone (weakest evidence)
    if (fileCount > 5) {
      return this._result(TaskComplexity.COMPLEX, C.LOW,
        `${fileCount} files retrieved; broad repository impact inferred`);
    }
    if (fileCount > 2) {
      return this._result(TaskComplexity.MEDIUM, C.LOW,
        `${fileCount} files retrieved; moderate impact inferred`);
    }

    // Absolute fallback: unknown query, minimal context
    return this._result(TaskComplexity.SIMPLE, C.WEAK,
      'No strong intent signals; defaulting to exploratory');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _result(
    complexity: TaskComplexity,
    confidence: number,
    reason: string,
  ): TaskClassification {
    return { complexity, confidence, reason };
  }
}
