/**
 * Tests for TaskRouter — the task complexity classifier.
 *
 * Tests cover:
 *   - SIMPLE keyword detection
 *   - COMPLEX keyword detection
 *   - File-count-based complexity escalation
 *   - Mixed-signal edge cases
 *   - Confidence-floor safety fallback contract
 *   - The three representative scenarios from the spec
 */
import { describe, it, expect } from 'vitest';
import { TaskRouter, TaskComplexity, type TaskClassification } from '../../src/orchestrator/task-router.js';

const router = new TaskRouter();

function classify(query: string, files: string[] = []): TaskClassification {
  return router.classify(query, files);
}

// ── Spec scenarios ────────────────────────────────────────────────────────────

describe('TaskRouter — spec scenarios', () => {
  it('S1: "explain authentication middleware" → SIMPLE', () => {
    const result = classify('explain authentication middleware', ['src/auth.ts']);
    expect(result.complexity).toBe(TaskComplexity.SIMPLE);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('S2: "fix login redirect loop" → MEDIUM (or COMPLEX if many files)', () => {
    const result = classify('fix the login redirect loop', ['src/auth.ts', 'src/routes/login.ts']);
    // 2 files + fix keyword → MEDIUM
    expect(result.complexity).toBe(TaskComplexity.MEDIUM);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('S3: "implement OAuth login with tests" → COMPLEX', () => {
    const manyFiles = [
      'src/auth.ts', 'src/routes/login.ts', 'src/middleware/auth.ts',
      'src/config.ts', 'src/services/oauth.ts', 'tests/auth.test.ts',
    ];
    const result = classify('implement OAuth login with tests', manyFiles);
    expect(result.complexity).toBe(TaskComplexity.COMPLEX);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });
});

// ── SIMPLE keyword detection ──────────────────────────────────────────────────

describe('TaskRouter — SIMPLE keywords', () => {
  const SIMPLE_QUERIES = [
    'explain how authentication works',
    'what does the SessionManager do',
    'why is this function async',
    'where is the database config',
    'show me the routing logic',
    'find the login handler',
    'describe the agent architecture',
    'list all API endpoints',
    'tell me about the indexing pipeline',
    'summarize the codebase structure',
    'walk me through the indexing process',
    'how does the query engine work',
  ];

  for (const query of SIMPLE_QUERIES) {
    it(`classifies as SIMPLE: "${query}"`, () => {
      const result = classify(query, ['src/foo.ts']);
      expect(result.complexity).toBe(TaskComplexity.SIMPLE);
    });
  }
});

// ── COMPLEX keyword detection ─────────────────────────────────────────────────

describe('TaskRouter — COMPLEX keywords produce MEDIUM/COMPLEX', () => {
  const ACTION_QUERIES = [
    'implement a new auth middleware',
    'add a password reset endpoint',
    'build the notification system',
    'create a user profile page',
    'refactor the database layer',
    'optimize the query engine',
    'migrate from v1 to v2 API',
    'add tests for the auth module',
    'fix bug in the session manager',
    'integrate Stripe payments',
    'generate API documentation',
    'update the config loader',
    'remove dead code from the agent system',
  ];

  for (const query of ACTION_QUERIES) {
    it(`classifies as MEDIUM or COMPLEX: "${query}"`, () => {
      const result = classify(query, ['src/foo.ts', 'src/bar.ts']);
      expect([TaskComplexity.MEDIUM, TaskComplexity.COMPLEX]).toContain(result.complexity);
    });
  }
});

// ── File count escalation ─────────────────────────────────────────────────────

describe('TaskRouter — file count escalation', () => {
  const query = 'implement OAuth login'; // clear complex keyword

  it('0–2 files → MEDIUM', () => {
    const r = classify(query, ['src/auth.ts']);
    expect(r.complexity).toBe(TaskComplexity.MEDIUM);
  });

  it('3–5 files → MEDIUM', () => {
    const files = Array.from({ length: 4 }, (_, i) => `src/file${i}.ts`);
    const r = classify(query, files);
    expect(r.complexity).toBe(TaskComplexity.MEDIUM);
  });

  it('6+ files → COMPLEX', () => {
    const files = Array.from({ length: 7 }, (_, i) => `src/file${i}.ts`);
    const r = classify(query, files);
    expect(r.complexity).toBe(TaskComplexity.COMPLEX);
  });
});

// ── Exploratory query with many files stays SIMPLE ────────────────────────────

describe('TaskRouter — exploratory queries with many files', () => {
  it('explain + 6 files → SIMPLE (user is reading, not writing)', () => {
    const files = Array.from({ length: 6 }, (_, i) => `src/f${i}.ts`);
    const r = classify('explain how the indexing pipeline works', files);
    expect(r.complexity).toBe(TaskComplexity.SIMPLE);
  });
});

// ── No-keyword fallback ────────────────────────────────────────────────────────

describe('TaskRouter — no keyword fallback', () => {
  it('ambiguous query, 0 files → SIMPLE (weak confidence)', () => {
    const r = classify('authentication', []);
    expect(r.complexity).toBe(TaskComplexity.SIMPLE);
    // Confidence is WEAK (0.55) — below the safety floor
    expect(r.confidence).toBeLessThan(TaskRouter.SAFETY_FLOOR);
  });

  it('ambiguous query, 3 files → MEDIUM', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const r = classify('authentication middleware session', files);
    expect(r.complexity).toBe(TaskComplexity.MEDIUM);
  });

  it('ambiguous query, 6+ files → COMPLEX (weak confidence)', () => {
    const files = Array.from({ length: 6 }, (_, i) => `src/f${i}.ts`);
    const r = classify('session token cookie', files);
    expect(r.complexity).toBe(TaskComplexity.COMPLEX);
    // Still low confidence — caller should consider fallback
    expect(r.confidence).toBeLessThanOrEqual(0.65);
  });
});

// ── Safety floor constant ─────────────────────────────────────────────────────

describe('TaskRouter.SAFETY_FLOOR', () => {
  it('is 0.60', () => {
    expect(TaskRouter.SAFETY_FLOOR).toBe(0.60);
  });

  it('weak-confidence result is below the safety floor', () => {
    // A 1-word query with no files has no strong signal
    const r = classify('cookie', []);
    expect(r.confidence).toBeLessThan(TaskRouter.SAFETY_FLOOR);
  });
});

// ── Result shape ──────────────────────────────────────────────────────────────

describe('TaskRouter — result shape', () => {
  it('always returns complexity, confidence, and reason', () => {
    const r = classify('explain auth', []);
    expect(r).toHaveProperty('complexity');
    expect(r).toHaveProperty('confidence');
    expect(r).toHaveProperty('reason');
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});
