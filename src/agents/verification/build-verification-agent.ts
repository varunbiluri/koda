import type { Agent, AgentInput, AgentOutput } from '../types.js';
import type { WorkspaceMemory } from '../../memory/workspace-memory.js';
import { runBuild } from '../../tools/terminal-tools.js';
import { logger } from '../../utils/logger.js';

export class BuildVerificationAgent implements Agent {
  name = 'build-verification';
  category = 'testing' as const;
  description = 'Verifies that the project builds successfully';

  async execute(
    input: AgentInput,
    memory: WorkspaceMemory
  ): Promise<AgentOutput> {
    logger.info('[BuildVerificationAgent] Running build verification...');

    const rootPath = (input.context?.rootPath as string) || process.cwd();

    try {
      const result = await runBuild(rootPath);

      if (result.success) {
        logger.info('[BuildVerificationAgent] Build passed');

        memory.info('Build verification passed successfully', this.name);

        return {
          agentName: this.name,
          success: true,
          result: 'Build verification passed',
        };
      } else {
        const output = result.data?.stderr || result.error || 'Build failed';
        const errorPreview = output.slice(0, 500);

        logger.error(`[BuildVerificationAgent] Build failed: ${errorPreview}`);

        memory.info(`Build verification failed: ${errorPreview}`, this.name);

        return {
          agentName: this.name,
          success: false,
          result: `Build failed`,
          error: errorPreview,
        };
      }
    } catch (err) {
      const error = (err as Error).message;
      logger.error(`[BuildVerificationAgent] Error: ${error}`);

      return {
        agentName: this.name,
        success: false,
        result: 'Build verification failed',
        error,
      };
    }
  }
}
