import type { VerificationResult } from './types.js';
import { runBuild, runTests, runLinter, runTerminal } from '../tools/terminal-tools.js';
import { logger } from '../utils/logger.js';

export class VerificationEngine {
  async verify(rootPath: string): Promise<VerificationResult> {
    const result: VerificationResult = {
      success: true,
      errors: [],
      warnings: [],
    };

    logger.info('Starting verification');

    // 1. Type check
    const typeCheckResult = await this.verifyTypeCheck(rootPath);
    result.typeCheckPassed = typeCheckResult.success;
    if (!typeCheckResult.success) {
      result.success = false;
      result.errors.push(...typeCheckResult.errors);
    }
    result.warnings.push(...typeCheckResult.warnings);

    // 2. Build
    const buildResult = await this.verifyBuild(rootPath);
    result.buildPassed = buildResult.success;
    if (!buildResult.success) {
      result.success = false;
      result.errors.push(...buildResult.errors);
    }

    // 3. Lint
    const lintResult = await this.verifyLint(rootPath);
    result.lintPassed = lintResult.success;
    if (!lintResult.success) {
      // Lint errors are warnings, not failures
      result.warnings.push(...lintResult.errors);
    }

    // 4. Tests (only if build passed)
    if (result.buildPassed) {
      const testResult = await this.verifyTests(rootPath);
      result.testsPassed = testResult.success;
      if (!testResult.success) {
        result.success = false;
        result.errors.push(...testResult.errors);
      }
    } else {
      result.testsPassed = false;
      result.warnings.push('Skipped tests because build failed');
    }

    logger.info(`Verification ${result.success ? 'passed' : 'failed'}`);
    return result;
  }

  private async verifyTypeCheck(rootPath: string): Promise<{ success: boolean; errors: string[]; warnings: string[] }> {
    try {
      const result = await runTerminal('npx tsc --noEmit', rootPath, 30000);

      if (result.success) {
        return { success: true, errors: [], warnings: [] };
      }

      const output = result.data?.stderr || result.error || '';
      const errors = this.parseTypeScriptErrors(output);

      return {
        success: false,
        errors: errors.length > 0 ? errors : ['Type check failed'],
        warnings: [],
      };
    } catch (err) {
      return {
        success: false,
        errors: [`Type check error: ${(err as Error).message}`],
        warnings: [],
      };
    }
  }

  private async verifyBuild(rootPath: string): Promise<{ success: boolean; errors: string[] }> {
    try {
      const result = await runBuild(rootPath);

      if (result.success) {
        return { success: true, errors: [] };
      }

      const output = result.data?.stderr || result.error || '';
      return {
        success: false,
        errors: [`Build failed: ${output.slice(0, 500)}`],
      };
    } catch (err) {
      return {
        success: false,
        errors: [`Build error: ${(err as Error).message}`],
      };
    }
  }

  private async verifyLint(rootPath: string): Promise<{ success: boolean; errors: string[] }> {
    try {
      const result = await runLinter(rootPath);

      if (result.success) {
        return { success: true, errors: [] };
      }

      const output = result.data?.stdout || result.data?.stderr || '';
      const lintIssues = this.parseLintErrors(output);

      return {
        success: lintIssues.length === 0,
        errors: lintIssues,
      };
    } catch (err) {
      // Linter might not be configured - treat as success
      return { success: true, errors: [] };
    }
  }

  private async verifyTests(rootPath: string): Promise<{ success: boolean; errors: string[] }> {
    try {
      const result = await runTests(rootPath);

      if (result.success) {
        return { success: true, errors: [] };
      }

      const output = result.data?.stdout || result.data?.stderr || '';
      const testErrors = this.parseTestErrors(output);

      return {
        success: false,
        errors: testErrors.length > 0 ? testErrors : ['Tests failed'],
      };
    } catch (err) {
      return {
        success: false,
        errors: [`Test error: ${(err as Error).message}`],
      };
    }
  }

  private parseTypeScriptErrors(output: string): string[] {
    const lines = output.split('\n');
    const errors: string[] = [];

    for (const line of lines) {
      if (line.includes('error TS')) {
        errors.push(line.trim());
      }
    }

    return errors.slice(0, 10); // Limit to first 10 errors
  }

  private parseLintErrors(output: string): string[] {
    const lines = output.split('\n');
    const errors: string[] = [];

    for (const line of lines) {
      if (line.includes('error') || line.includes('warning')) {
        errors.push(line.trim());
      }
    }

    return errors.slice(0, 10);
  }

  private parseTestErrors(output: string): string[] {
    const lines = output.split('\n');
    const errors: string[] = [];

    for (const line of lines) {
      if (line.includes('FAIL') || line.includes('Error:') || line.includes('✗')) {
        errors.push(line.trim());
      }
    }

    return errors.slice(0, 10);
  }
}
