/**
 * GlobalMemoryStore — cross-task persistent memory for Koda.
 *
 * Unlike WorkspaceIntelligence (which tracks problem→solution pairs),
 * GlobalMemoryStore tracks the full task lifecycle:
 *
 *   - Task history     — every task run, its outcome, duration, files changed
 *   - Fix records      — what error type occurred, what strategy fixed it
 *   - Recurring issues — patterns that appear more than once across tasks
 *   - Success patterns — which task types succeed on the first attempt
 *
 * Stored at: <rootPath>/.koda/global-memory.json
 *
 * Usage:
 * ```ts
 * const mem = await GlobalMemoryStore.load(rootPath);
 * mem.recordTask({ description: 'add auth', succeeded: true, durationMs: 4200, filesChanged: ['src/auth.ts'] });
 * mem.recordFix('compile_error', 'run tsc --noEmit first', true);
 * await mem.save();
 * const hint = mem.getContextHint('auth');
 * ```
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TaskRecord {
  /** Short task description. */
  description:  string;
  /** Whether the task ultimately succeeded. */
  succeeded:    boolean;
  /** Wall-clock milliseconds for the full execution. */
  durationMs:   number;
  /** Files touched during this task. */
  filesChanged: string[];
  /** ISO timestamp. */
  recordedAt:   string;
  /** Number of retry attempts before success/failure. */
  retries:      number;
}

export interface FixRecord {
  /** FailureAnalyzer type: compile_error | test_failure | missing_dep | … */
  failureType: string;
  /** Strategy that was used. */
  strategy:    string;
  /** Whether this strategy resolved the issue. */
  worked:      boolean;
  /** Times this exact (type, strategy) pair has been seen. */
  count:       number;
  /** Last seen ISO timestamp. */
  lastSeen:    string;
}

export interface RecurringIssue {
  /** Normalized description of the issue. */
  description: string;
  /** Times this issue was encountered. */
  count:       number;
  /** Last seen ISO timestamp. */
  lastSeen:    string;
}

/**
 * SemanticPattern — a causal reasoning record.
 *
 * Links a problem to its root cause, the fix applied, and the reasoning
 * behind that fix. Used for smarter planning and fewer retries.
 *
 * Examples:
 *   problem:   "null pointer in auth middleware"
 *   rootCause: "token field not validated before access"
 *   fix:       "add guard: if (!token) return 401"
 *   reasoning: "JWT tokens may be absent if header is missing; always guard"
 *   pattern:   "null_access → missing_guard"
 */
export interface SemanticPattern {
  /** Short description of the symptom (normalised, ≤ 120 chars). */
  problem:     string;
  /** Root cause analysis — WHY it happened. */
  rootCause:   string;
  /** Fix that resolved it. */
  fix:         string;
  /** Engineer's reasoning — WHY this fix works. */
  reasoning:   string;
  /** Generalised pattern label, e.g. "null_access → missing_guard". */
  pattern:     string;
  /** How many times this pattern has been seen. */
  occurrences: number;
  /** ISO timestamp of last occurrence. */
  lastSeen:    string;
}

interface GlobalMemoryStoreData {
  version:          number;
  tasks:            TaskRecord[];
  fixes:            FixRecord[];
  recurringIssues:  RecurringIssue[];
  semanticPatterns: SemanticPattern[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STORE_VERSION       = 2; // bumped for semantic patterns field
const MAX_TASKS           = 200;
const MAX_FIXES           = 300;
const MAX_ISSUES          = 50;
const MAX_SEMANTIC        = 100;

// ── GlobalMemoryStore ──────────────────────────────────────────────────────────

export class GlobalMemoryStore {
  private data: GlobalMemoryStoreData;
  private readonly filePath: string;

  private constructor(filePath: string, data: GlobalMemoryStoreData) {
    this.filePath = filePath;
    this.data     = data;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static async load(rootPath: string): Promise<GlobalMemoryStore> {
    const fp = storePath(rootPath);
    try {
      const raw  = await fs.readFile(fp, 'utf8');
      const data = JSON.parse(raw) as GlobalMemoryStoreData;
      // Migrate v1 → v2: add missing semanticPatterns field
      if (data.version === 1) {
        data.version          = STORE_VERSION;
        data.semanticPatterns = [];
      }
      if (data.version !== STORE_VERSION) return new GlobalMemoryStore(fp, fresh());
      if (!data.semanticPatterns) data.semanticPatterns = [];
      return new GlobalMemoryStore(fp, data);
    } catch {
      return new GlobalMemoryStore(fp, fresh());
    }
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Record a completed task execution.
   */
  recordTask(task: Omit<TaskRecord, 'recordedAt'>): void {
    this.data.tasks.unshift({ ...task, recordedAt: new Date().toISOString() });
    if (this.data.tasks.length > MAX_TASKS) {
      this.data.tasks = this.data.tasks.slice(0, MAX_TASKS);
    }
  }

  /**
   * Record a fix attempt for a given failure type and strategy.
   * Deduplicates on (failureType, strategy) — increments count on match.
   */
  recordFix(failureType: string, strategy: string, worked: boolean): void {
    const existing = this.data.fixes.find(
      (f) => f.failureType === failureType && f.strategy === strategy,
    );
    if (existing) {
      existing.count++;
      existing.worked  = worked;
      existing.lastSeen = new Date().toISOString();
    } else {
      this.data.fixes.unshift({
        failureType,
        strategy,
        worked,
        count:    1,
        lastSeen: new Date().toISOString(),
      });
      if (this.data.fixes.length > MAX_FIXES) {
        this.data.fixes = this.data.fixes.slice(0, MAX_FIXES);
      }
    }
  }

  /**
   * Record an encountered issue. Recurring issues (count ≥ 2) are flagged
   * so future tasks can be warned proactively.
   */
  recordIssue(description: string): void {
    const key  = description.toLowerCase().slice(0, 120);
    const prev = this.data.recurringIssues.find(
      (i) => similarity(i.description, key) > 0.6,
    );
    if (prev) {
      prev.count++;
      prev.lastSeen = new Date().toISOString();
    } else {
      this.data.recurringIssues.unshift({
        description: key,
        count:       1,
        lastSeen:    new Date().toISOString(),
      });
      if (this.data.recurringIssues.length > MAX_ISSUES) {
        this.data.recurringIssues = this.data.recurringIssues.slice(0, MAX_ISSUES);
      }
    }
  }

  /**
   * Record a semantic causal pattern: problem → rootCause → fix → reasoning.
   *
   * Deduplicates on `pattern` label — increments `occurrences` on match.
   * The pattern label should be a generalised template like
   * "null_access → missing_guard" or "missing_dep → wrong_import_path".
   */
  recordSemanticPattern(
    problem:   string,
    rootCause: string,
    fix:       string,
    reasoning: string,
    pattern:   string,
  ): void {
    const normProblem = problem.toLowerCase().slice(0, 120);
    const existing = this.data.semanticPatterns.find(
      (p) => p.pattern === pattern && similarity(p.problem, normProblem) > 0.5,
    );

    if (existing) {
      existing.occurrences++;
      existing.lastSeen = new Date().toISOString();
      // Update with latest details (more recent = more accurate)
      existing.rootCause = rootCause;
      existing.fix       = fix;
      existing.reasoning = reasoning;
    } else {
      this.data.semanticPatterns.unshift({
        problem:     normProblem,
        rootCause:   rootCause.slice(0, 400),
        fix:         fix.slice(0, 400),
        reasoning:   reasoning.slice(0, 400),
        pattern,
        occurrences: 1,
        lastSeen:    new Date().toISOString(),
      });
      if (this.data.semanticPatterns.length > MAX_SEMANTIC) {
        this.data.semanticPatterns = this.data.semanticPatterns.slice(0, MAX_SEMANTIC);
      }
    }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Return a markdown context hint for injection into task prompts.
   * Includes relevant past tasks, semantic patterns, and recurring issues.
   */
  getContextHint(query: string, maxItems = 3): string {
    const relevant  = this.getRelevantTasks(query, maxItems);
    const issues    = this.getRecurringIssues(3);
    const semantic  = this.getRelevantSemanticPatterns(query, 2);

    if (relevant.length === 0 && issues.length === 0 && semantic.length === 0) return '';

    const lines: string[] = ['## Memory from past sessions', ''];

    if (relevant.length > 0) {
      lines.push('**Similar past tasks:**');
      for (const t of relevant) {
        const status = t.succeeded ? '✔' : '✗';
        const retryNote = t.retries > 0 ? ` (${t.retries} retries)` : '';
        lines.push(`- ${status} ${t.description}${retryNote} — ${t.filesChanged.slice(0, 3).join(', ')}`);
      }
      lines.push('');
    }

    if (semantic.length > 0) {
      lines.push('**Known patterns (root cause → fix reasoning):**');
      for (const p of semantic) {
        lines.push(`- Pattern: \`${p.pattern}\` (seen ${p.occurrences}×)`);
        lines.push(`  Root cause: ${p.rootCause}`);
        lines.push(`  Fix: ${p.fix}`);
        lines.push(`  Reasoning: ${p.reasoning}`);
      }
      lines.push('');
    }

    if (issues.length > 0) {
      lines.push('**Recurring issues to watch for:**');
      for (const i of issues) {
        lines.push(`- ${i.description} (seen ${i.count}×)`);
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  /**
   * Return semantic patterns relevant to the query, ranked by similarity + occurrences.
   */
  getRelevantSemanticPatterns(query: string, limit = 3): SemanticPattern[] {
    const qWords = tokenise(query);
    return this.data.semanticPatterns
      .map((p) => ({
        p,
        score: overlap(qWords, tokenise(p.problem + ' ' + p.pattern)) + p.occurrences * 0.1,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.p);
  }

  /**
   * Return the best-known fix strategy for a failure type,
   * based on historical success rate.
   * Returns null when no data is available.
   */
  getBestFixStrategy(failureType: string): string | null {
    const candidates = this.data.fixes
      .filter((f) => f.failureType === failureType && f.worked)
      .sort((a, b) => b.count - a.count);
    return candidates[0]?.strategy ?? null;
  }

  /**
   * Return recurring issues (seen more than once), sorted by frequency.
   */
  getRecurringIssues(limit = 5): RecurringIssue[] {
    return this.data.recurringIssues
      .filter((i) => i.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Return past tasks relevant to the query, ranked by word overlap.
   */
  getRelevantTasks(query: string, limit = 5): TaskRecord[] {
    const queryWords = tokenise(query);
    return this.data.tasks
      .map((t) => ({ t, score: overlap(queryWords, tokenise(t.description)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.t);
  }

  /** Total number of tasks recorded. */
  get taskCount(): number { return this.data.tasks.length; }

  /** Average retries across all recorded tasks. */
  get averageRetries(): number {
    if (this.data.tasks.length === 0) return 0;
    const total = this.data.tasks.reduce((s, t) => s + t.retries, 0);
    return total / this.data.tasks.length;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      // non-fatal — memory is best-effort
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function storePath(rootPath: string): string {
  return path.join(rootPath, '.koda', 'global-memory.json');
}

function fresh(): GlobalMemoryStoreData {
  return { version: STORE_VERSION, tasks: [], fixes: [], recurringIssues: [], semanticPatterns: [] };
}

function tokenise(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const w of a) if (b.has(w)) count++;
  return count;
}

/** Dice-coefficient similarity for two strings (character bigrams). */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const bigrams = (s: string) => new Set([...s.split('').map((_, i) => s.slice(i, i + 2))]);
  const ba = bigrams(a);
  const bb = bigrams(b);
  let common = 0;
  for (const g of ba) if (bb.has(g)) common++;
  return (2 * common) / (ba.size + bb.size || 1);
}
