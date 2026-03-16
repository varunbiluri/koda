/**
 * FailureAnalyzer — classifies execution errors and generates targeted fix prompts.
 *
 * Used by PlanExecutor to insert recovery steps when a plan step fails.
 *
 * Failure types:
 *   compile_error     — TypeScript / syntax compilation errors
 *   test_failure      — Unit or integration tests failing
 *   missing_dep       — Module not found / missing import
 *   runtime_error     — TypeError, ReferenceError, etc. at runtime
 *   logic_bug         — Tests fail but code compiles (behavioral mismatch)
 *   unknown           — Cannot classify
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type FailureType =
  | 'compile_error'
  | 'test_failure'
  | 'missing_dep'
  | 'runtime_error'
  | 'logic_bug'
  | 'unknown';

export interface FailureAnalysis {
  type:       FailureType;
  /** Human-readable description of the detected failure. */
  summary:    string;
  /** Targeted prompt to inject as a recovery step. */
  fixPrompt:  string;
  /** Confidence in the classification (0–1). */
  confidence: number;
}

// ── Classifiers ────────────────────────────────────────────────────────────────

const CLASSIFIERS: Array<{
  type:       FailureType;
  patterns:   RegExp[];
  confidence: number;
  summary:    (match: string) => string;
  fixPrompt:  (errorText: string) => string;
}> = [
  {
    type:       'compile_error',
    patterns:   [/error TS\d+/i, /TypeScript.*error/i, /tsc.*failed/i, /SyntaxError.*unexpected/i],
    confidence: 0.95,
    summary:    () => 'TypeScript compilation error detected',
    fixPrompt:  (e) => [
      'A TypeScript compilation error occurred. Fix it now.',
      '',
      'Instructions:',
      '1. Run `tsc --noEmit` with run_terminal to see the full error list.',
      '2. Read the files mentioned in the errors.',
      '3. Fix each error: wrong type, missing import, bad signature, etc.',
      '4. Re-run `tsc --noEmit` to confirm all errors are resolved.',
      '',
      `Error output:\n${e.slice(0, 800)}`,
    ].join('\n'),
  },
  {
    type:       'missing_dep',
    patterns:   [
      /cannot find module/i,
      /module not found/i,
      /failed to resolve import/i,
      /err_module_not_found/i,
      /cannot find name/i,
    ],
    confidence: 0.92,
    summary:    () => 'Missing module or import detected',
    fixPrompt:  (e) => [
      'A missing module or import error occurred. Fix it now.',
      '',
      'Instructions:',
      '1. Use grep_code to find the correct module path for the imported symbol.',
      '2. Check if the package needs to be installed (check package.json first).',
      '3. Correct the import path or install the missing package.',
      '4. Verify the fix by running the failing command again.',
      '',
      `Error output:\n${e.slice(0, 800)}`,
    ].join('\n'),
  },
  {
    type:       'test_failure',
    patterns:   [
      /\d+ test(s)? failed/i,
      /FAIL\s+tests?\//i,
      /AssertionError/i,
      /Expected.*Received/i,
      /✗|×\s+/,
      /● .+ › .+/,       // Jest/Vitest test name pattern
    ],
    confidence: 0.88,
    summary:    () => 'One or more tests are failing',
    fixPrompt:  (e) => [
      'Tests are failing. Investigate and fix the root cause.',
      '',
      'Instructions:',
      '1. Read the failing test file to understand what behavior is expected.',
      '2. Read the implementation file being tested.',
      '3. Identify the mismatch between implementation and expected behavior.',
      '4. Fix the implementation (do NOT change test assertions unless they are wrong).',
      '5. Re-run the failing tests to verify the fix.',
      '',
      `Test output:\n${e.slice(0, 800)}`,
    ].join('\n'),
  },
  {
    type:       'runtime_error',
    patterns:   [
      /TypeError:/i,
      /ReferenceError:/i,
      /RangeError:/i,
      /cannot read propert/i,
      /is not a function/i,
      /is not defined/i,
      /undefined is not/i,
    ],
    confidence: 0.85,
    summary:    () => 'Runtime error (TypeError / ReferenceError) detected',
    fixPrompt:  (e) => [
      'A runtime error occurred during execution. Fix it now.',
      '',
      'Instructions:',
      '1. Read the stack trace to identify the exact file and line.',
      '2. Read the relevant file and understand the code path.',
      '3. Fix the null/undefined access or incorrect type assumption.',
      '4. Add a guard or type check if the value can legitimately be absent.',
      '',
      `Error output:\n${e.slice(0, 800)}`,
    ].join('\n'),
  },
];

// ── FailureAnalyzer ───────────────────────────────────────────────────────────

/**
 * Classifies a failure string and produces a targeted fix prompt.
 *
 * Evaluation order: classifiers are tested in order of confidence (highest first).
 * If no classifier matches, returns `unknown` with a generic fix prompt.
 */
export class FailureAnalyzer {
  /**
   * Classify a failure string.
   *
   * @param errorText - Combined stderr/stdout from the failed step.
   */
  classify(errorText: string): FailureAnalysis {
    for (const c of CLASSIFIERS) {
      if (c.patterns.some((p) => p.test(errorText))) {
        return {
          type:       c.type,
          summary:    c.summary(errorText),
          fixPrompt:  c.fixPrompt(errorText),
          confidence: c.confidence,
        };
      }
    }

    // Test failure that didn't match assertion patterns — treat as logic bug
    if (/failed|error|exception/i.test(errorText)) {
      return {
        type:       'logic_bug',
        summary:    'General failure detected — possible logic bug',
        fixPrompt:  [
          'An error occurred during step execution. Investigate and fix it.',
          '',
          'Instructions:',
          '1. Read all files modified in the previous step.',
          '2. Identify incorrect logic, missing code, or wrong assumptions.',
          '3. Apply targeted fixes using edit_file.',
          '4. Verify the fix resolves the issue.',
          '',
          `Error output:\n${errorText.slice(0, 800)}`,
        ].join('\n'),
        confidence: 0.60,
      };
    }

    return {
      type:       'unknown',
      summary:    'Unable to classify failure',
      fixPrompt:  `Review the previous step output and fix any issues:\n\n${errorText.slice(0, 400)}`,
      confidence: 0.30,
    };
  }

  /**
   * Extract the most relevant portion of an error string for display.
   * Strips ANSI escape codes and limits to 400 chars.
   */
  static extractSnippet(errorText: string, maxChars = 400): string {
    // Strip ANSI escape codes
    const clean = errorText.replace(/\x1b\[[0-9;]*m/g, '');
    // Find the first real error line
    const lines = clean.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(0, 20).join('\n').slice(0, maxChars);
  }
}

/** Singleton instance for use across the execution pipeline. */
export const failureAnalyzer = new FailureAnalyzer();
