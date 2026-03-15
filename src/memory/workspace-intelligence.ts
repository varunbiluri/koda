import * as fs   from 'node:fs/promises';
import * as path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LearnedPattern {
  /** Short description of the problem that was solved. */
  problem:      string;
  /** What the AI did to resolve it. */
  solution:     string;
  /** Files that were modified during the successful task. */
  filesChanged: string[];
  /** ISO timestamp of when this was recorded. */
  recordedAt:   string;
  /** Number of times this pattern has been referenced (for ranking). */
  hits:         number;
}

export interface ProjectProfile {
  /** Primary language detected (TypeScript, Python, etc.) */
  language:       string;
  /** Key architectural patterns observed (e.g. "event-driven", "layered"). */
  patterns:       string[];
  /** Files most commonly edited across sessions. */
  hotFiles:       string[];
  /** Last updated ISO timestamp. */
  updatedAt:      string;
}

interface WorkspaceIntelligenceStore {
  version:     number;
  profile:     ProjectProfile;
  patterns:    LearnedPattern[];
}

const STORE_VERSION = 1;
const MAX_PATTERNS  = 100; // cap to avoid unbounded growth

// ── Helpers ───────────────────────────────────────────────────────────────────

function storePath(rootPath: string): string {
  return path.join(rootPath, '.koda', 'workspace-memory.json');
}

function defaultStore(): WorkspaceIntelligenceStore {
  return {
    version: STORE_VERSION,
    profile: {
      language:  'unknown',
      patterns:  [],
      hotFiles:  [],
      updatedAt: new Date().toISOString(),
    },
    patterns: [],
  };
}

/**
 * Naïve relevance score: count word overlaps between query and a pattern's
 * problem/solution text.  Fast enough for < 100 stored patterns.
 */
function relevance(query: string, pattern: LearnedPattern): number {
  const words = new Set(
    query.toLowerCase().split(/\W+/).filter((w) => w.length > 2),
  );
  const text = `${pattern.problem} ${pattern.solution}`.toLowerCase();
  let score  = 0;
  for (const word of words) {
    if (text.includes(word)) score++;
  }
  // Boost by usage hits so well-tested patterns surface first
  return score + pattern.hits * 0.1;
}

// ── WorkspaceIntelligence ─────────────────────────────────────────────────────

/**
 * WorkspaceIntelligence — persistent cross-session memory for Koda.
 *
 * Records problem→solution mappings when a task completes successfully and
 * surfaces the most relevant patterns when building the AI system prompt.
 *
 * All data is stored in `.koda/workspace-memory.json` alongside the index.
 */
export class WorkspaceIntelligence {
  private store: WorkspaceIntelligenceStore = defaultStore();
  private dirty = false;

  private constructor(private readonly rootPath: string) {}

  // ── Factory ────────────────────────────────────────────────────────────────

  /** Load from disk, or return a fresh instance if no store file exists. */
  static async load(rootPath: string): Promise<WorkspaceIntelligence> {
    const wi = new WorkspaceIntelligence(rootPath);
    try {
      const raw = await fs.readFile(storePath(rootPath), 'utf-8');
      wi.store  = JSON.parse(raw) as WorkspaceIntelligenceStore;
    } catch {
      // No store yet — use the default (fresh instance)
    }
    return wi;
  }

  // ── Read API ───────────────────────────────────────────────────────────────

  getProfile(): ProjectProfile {
    return this.store.profile;
  }

  /**
   * Return up to `limit` patterns most relevant to the given query.
   * Patterns are ranked by word-overlap + usage hit count.
   */
  getRelevantPatterns(query: string, limit = 5): LearnedPattern[] {
    if (this.store.patterns.length === 0) return [];

    return [...this.store.patterns]
      .map((p) => ({ p, score: relevance(query, p) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ p }) => p);
  }

  /** Return all stored patterns (for diagnostic commands). */
  getAllPatterns(): LearnedPattern[] {
    return [...this.store.patterns];
  }

  // ── Write API ──────────────────────────────────────────────────────────────

  /**
   * Record a successful task outcome.
   *
   * Stores: problem, solution, filesModified (= filesChanged), and timestamp.
   * If an existing pattern with the same problem string already exists,
   * its solution and files are updated and its hit counter incremented.
   *
   * @param problem      - Short description of the task / question.
   * @param solution     - What was done to resolve it (first 300 chars of response).
   * @param filesChanged - Files that were modified during execution (from ExecutionMetrics).
   */
  recordSuccess(
    problem:      string,
    solution:     string,
    filesChanged: string[],
  ): void {
    const existing = this.store.patterns.find(
      (p) => p.problem.toLowerCase() === problem.toLowerCase(),
    );

    const now = new Date().toISOString();

    if (existing) {
      existing.solution     = solution;
      existing.filesChanged = filesChanged;
      existing.recordedAt   = now;
      existing.hits++;
    } else {
      this.store.patterns.push({
        problem,
        solution,
        filesChanged,
        recordedAt: now,
        hits:       0,
      });
    }

    // Trim oldest, least-used entries to stay under the cap
    if (this.store.patterns.length > MAX_PATTERNS) {
      this.store.patterns.sort((a, b) => b.hits - a.hits || b.recordedAt.localeCompare(a.recordedAt));
      this.store.patterns = this.store.patterns.slice(0, MAX_PATTERNS);
    }

    this.dirty = true;
  }

  /** Update the project profile (language, patterns, hotFiles). */
  updateProfile(partial: Partial<Omit<ProjectProfile, 'updatedAt'>>): void {
    this.store.profile = {
      ...this.store.profile,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    this.dirty = true;
  }

  /** Track that a file was edited (promotes it to hotFiles list). */
  recordFileEdited(filePath: string): void {
    const hot = this.store.profile.hotFiles;
    if (!hot.includes(filePath)) {
      hot.unshift(filePath);
      this.store.profile.hotFiles = hot.slice(0, 20); // keep top-20
      this.dirty = true;
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /** Flush any pending writes to disk. Non-fatal on error. */
  async save(): Promise<void> {
    if (!this.dirty) return;
    try {
      const dir = path.join(this.rootPath, '.koda');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        storePath(this.rootPath),
        JSON.stringify(this.store, null, 2),
        'utf-8',
      );
      this.dirty = false;
    } catch {
      // Non-fatal — workspace memory is a best-effort feature
    }
  }

  // ── Prompt formatting ──────────────────────────────────────────────────────

  /**
   * Format the most relevant patterns as a compact text block suitable for
   * injection into the AI system prompt.
   *
   * Returns an empty string when no relevant patterns exist.
   */
  /**
   * Format the top 3 most-relevant past solutions for injection into the
   * AI system prompt.  Includes the files that were modified so the model
   * can infer which files are typically touched for similar tasks.
   *
   * Returns an empty string when no relevant patterns exist.
   */
  formatForPrompt(query: string, limit = 3): string {
    const patterns = this.getRelevantPatterns(query, limit);
    if (patterns.length === 0) return '';

    const lines: string[] = [
      '',
      '## Past Solutions (workspace memory — top 3 similar tasks)',
      '',
    ];

    for (const p of patterns) {
      lines.push(`**Problem:** ${p.problem}`);
      lines.push(`**Solution:** ${p.solution}`);
      if (p.filesChanged.length > 0) {
        lines.push(`**Files modified:** ${p.filesChanged.slice(0, 5).join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
