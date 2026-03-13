export interface VerificationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  buildPassed?: boolean;
  testsPassed?: boolean;
  lintPassed?: boolean;
  typeCheckPassed?: boolean;
}

export interface QualityMetrics {
  codeComplexity?: number;
  testCoverage?: number;
  lintIssues: number;
  typeErrors: number;
  buildErrors: number;
}
