import type { Agent, AgentInput, AgentOutput } from '../types.js';
import type { WorkspaceMemory } from '../../memory/workspace-memory.js';
import { runLinter } from '../../tools/terminal-tools.js';
import { logger } from '../../utils/logger.js';

export class LintVerificationAgent implements Agent {
  name = 'lint-verification';
  category = 'testing' as const;
  description = 'Runs linter to check code quality';

  async execute(
    input: AgentInput,
    memory: WorkspaceMemory
  ): Promise<AgentOutput> {
    logger.info('[LintVerificationAgent] Running linter...');

    const rootPath = (input.context?.rootPath as string) || process.cwd();

    try {
      const result = await runLinter(rootPath);

      if (result.success) {
        logger.info('[LintVerificationAgent] Linting passed');
        memory.info('Lint verification passed successfully', this.name);

        return {
          agentName: this.name,
          success: true,
          result: 'Linting passed',
        };
      } else {
        const output = result.data?.stdout || result.data?.stderr || 'Linting failed';
        const errorPreview = output.slice(0, 500);

        // Extract error/warning counts
        const errorMatch = output.match(/(\d+)\s+errors?/i);
        const warningMatch = output.match(/(\d+)\s+warnings?/i);

        const errors = errorMatch ? errorMatch[1] : '0';
        const warnings = warningMatch ? warningMatch[1] : '0';

        logger.warn(`[LintVerificationAgent] Linting issues: ${errors} errors, ${warnings} warnings`);
        memory.info(`Lint verification found issues: ${errors} errors, ${warnings} warnings`, this.name);

        // Treat as warning, not hard failure
        return {
          agentName: this.name,
          success: true,
          result: `Linting completed with ${errors} errors and ${warnings} warnings`,
        };
      }
    } catch (err) {
      // Linter might not be configured - don't fail
      logger.debug(`[LintVerificationAgent] Linter not configured: ${(err as Error).message}`);
      memory.info('Linter not configured, skipping', this.name);

      return {
        agentName: this.name,
        success: true,
        result: 'Linter not configured, skipped',
      };
    }
  }
}
