import type { Agent, AgentInput, AgentOutput } from '../types.js';
import type { WorkspaceMemory } from '../../memory/workspace-memory.js';
import { VerificationEngine } from '../../evaluation/verification-engine.js';
import { logger } from '../../utils/logger.js';

export class ComprehensiveVerificationAgent implements Agent {
  name = 'comprehensive-verification';
  category = 'testing' as const;
  description = 'Runs full verification suite: type check, build, lint, and tests';

  private verificationEngine: VerificationEngine;

  constructor() {
    this.verificationEngine = new VerificationEngine();
  }

  async execute(
    input: AgentInput,
    memory: WorkspaceMemory
  ): Promise<AgentOutput> {
    logger.info('[ComprehensiveVerificationAgent] Running full verification suite...');

    const rootPath = (input.context?.rootPath as string) || process.cwd();

    try {
      const result = await this.verificationEngine.verify(rootPath);

      const summary = this.formatSummary(result);

      memory.info(summary, this.name);

      if (result.success) {
        logger.info('[ComprehensiveVerificationAgent] All verifications passed');

        return {
          agentName: this.name,
          success: true,
          result: summary,
        };
      } else {
        logger.error('[ComprehensiveVerificationAgent] Verification failed');

        const errorDetails = [
          ...result.errors.slice(0, 5),
          result.errors.length > 5 ? `... and ${result.errors.length - 5} more errors` : '',
        ]
          .filter(Boolean)
          .join('\n');

        return {
          agentName: this.name,
          success: false,
          result: summary,
          error: errorDetails,
        };
      }
    } catch (err) {
      const error = (err as Error).message;
      logger.error(`[ComprehensiveVerificationAgent] Error: ${error}`);

      return {
        agentName: this.name,
        success: false,
        result: 'Comprehensive verification failed',
        error,
      };
    }
  }

  private formatSummary(result: any): string {
    const parts = ['Verification Results:'];

    parts.push(`  Type Check: ${result.typeCheckPassed ? '✓' : '✗'}`);
    parts.push(`  Build: ${result.buildPassed ? '✓' : '✗'}`);
    parts.push(`  Lint: ${result.lintPassed ? '✓' : '✗'}`);
    parts.push(`  Tests: ${result.testsPassed ? '✓' : '✗'}`);

    if (result.errors.length > 0) {
      parts.push(`\nErrors: ${result.errors.length}`);
    }

    if (result.warnings.length > 0) {
      parts.push(`Warnings: ${result.warnings.length}`);
    }

    return parts.join('\n');
  }
}
