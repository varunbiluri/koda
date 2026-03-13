import type { Agent, AgentInput, AgentOutput } from '../types.js';
import type { WorkspaceMemory } from '../../memory/workspace-memory.js';
import { runTests } from '../../tools/terminal-tools.js';
import { logger } from '../../utils/logger.js';

export class TestVerificationAgent implements Agent {
  name = 'test-verification';
  category = 'testing' as const;
  description = 'Runs test suite to verify code changes';

  async execute(
    input: AgentInput,
    memory: WorkspaceMemory
  ): Promise<AgentOutput> {
    logger.info('[TestVerificationAgent] Running tests...');

    const rootPath = (input.context?.rootPath as string) || process.cwd();

    try {
      const result = await runTests(rootPath);

      if (result.success) {
        const output = result.data?.stdout || '';
        const passedMatch = output.match(/(\d+)\s+passed/);
        const passedCount = passedMatch ? passedMatch[1] : 'all';

        logger.info(`[TestVerificationAgent] Tests passed (${passedCount})`);
        memory.info(`Test verification passed: ${passedCount} tests passed`, this.name);

        return {
          agentName: this.name,
          success: true,
          result: `Tests passed: ${passedCount}`,
        };
      } else {
        const output = result.data?.stdout || result.data?.stderr || result.error || 'Tests failed';
        const errorPreview = output.slice(0, 500);

        // Extract failed test info
        const failedMatch = output.match(/(\d+)\s+failed/);
        const failedCount = failedMatch ? failedMatch[1] : 'some';

        logger.error(`[TestVerificationAgent] Tests failed: ${failedCount} tests`);
        memory.info(`Test verification failed: ${failedCount} tests failed`, this.name);

        return {
          agentName: this.name,
          success: false,
          result: `Tests failed: ${failedCount} tests`,
          error: errorPreview,
        };
      }
    } catch (err) {
      const error = (err as Error).message;
      logger.error(`[TestVerificationAgent] Error: ${error}`);

      return {
        agentName: this.name,
        success: false,
        result: 'Test verification failed',
        error,
      };
    }
  }
}
