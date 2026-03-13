import type { Agent, AgentInput, AgentOutput } from '../types.js';
import type { WorkspaceMemory } from '../../memory/workspace-memory.js';
import { runTerminal } from '../../tools/terminal-tools.js';
import { logger } from '../../utils/logger.js';

export class TypeCheckVerificationAgent implements Agent {
  name = 'type-check-verification';
  category = 'testing' as const;
  description = 'Runs TypeScript type checking';

  async execute(
    input: AgentInput,
    memory: WorkspaceMemory
  ): Promise<AgentOutput> {
    logger.info('[TypeCheckVerificationAgent] Running type checker...');

    const rootPath = (input.context?.rootPath as string) || process.cwd();

    try {
      const result = await runTerminal('npx tsc --noEmit', rootPath, 30000);

      if (result.success) {
        logger.info('[TypeCheckVerificationAgent] Type checking passed');
        memory.info('Type check verification passed successfully', this.name);

        return {
          agentName: this.name,
          success: true,
          result: 'Type checking passed',
        };
      } else {
        const output = result.data?.stderr || result.error || 'Type checking failed';

        // Parse TypeScript errors
        const errors = this.parseTypeScriptErrors(output);
        const errorCount = errors.length;
        const errorPreview = errors.slice(0, 5).join('\n');

        logger.error(`[TypeCheckVerificationAgent] Type errors found: ${errorCount}`);
        memory.info(`Type check verification failed: ${errorCount} errors found`, this.name);

        return {
          agentName: this.name,
          success: false,
          result: `Type checking failed: ${errorCount} errors`,
          error: errorPreview,
        };
      }
    } catch (err) {
      const error = (err as Error).message;
      logger.error(`[TypeCheckVerificationAgent] Error: ${error}`);

      return {
        agentName: this.name,
        success: false,
        result: 'Type check verification failed',
        error,
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
}
