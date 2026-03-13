import { BaseAgent } from '../base-agent.js';
import type { AgentInput, AgentOutput } from '../types.js';
import type { WorkspaceMemory } from '../../memory/workspace-memory.js';
import { writeFile, readFile } from '../../tools/filesystem-tools.js';

export class BackendAgent extends BaseAgent {
  constructor() {
    super(
      'backend-agent',
      'coding',
      'Implements backend services, business logic, and data processing',
    );
  }

  async execute(input: AgentInput, memory: WorkspaceMemory): Promise<AgentOutput> {
    try {
      memory.info(`Implementing backend logic: ${input.task}`, this.name);

      // Use AI to generate implementation plan
      const plan = await this.useAI(
        `Generate a detailed implementation plan for this backend task: "${input.task}".
        Include:
        1. File structure
        2. Class/function names
        3. Key logic flows
        4. Error handling approach`,
        memory,
      );

      if (!plan) {
        return this.failure('AI planning not available');
      }

      // Generate code based on plan
      const code = await this.generateBackendCode(input.task, plan, memory);
      const filesModified: string[] = [];

      // Write generated code
      for (const [filePath, content] of Object.entries(code)) {
        const result = await writeFile(filePath, content, memory.rootPath);
        if (result.success) {
          filesModified.push(filePath);
          memory.info(`Created/updated ${filePath}`, this.name);
        } else {
          memory.error(`Failed to write ${filePath}: ${result.error}`, this.name);
        }
      }

      return this.success(
        { plan, files: filesModified },
        {
          filesModified,
          toolsUsed: ['writeFile'],
          nextSteps: ['Add tests for new backend logic', 'Update API documentation'],
        },
      );
    } catch (err) {
      return this.failure((err as Error).message);
    }
  }

  private async generateBackendCode(
    task: string,
    plan: string,
    memory: WorkspaceMemory,
  ): Promise<Record<string, string>> {
    // Simplified code generation - in production, would use more sophisticated AI
    const code: Record<string, string> = {};

    // Generate a service file
    const serviceName = this.extractServiceName(task);
    code[`src/services/${serviceName}.ts`] = this.generateServiceTemplate(serviceName, task);

    return code;
  }

  private extractServiceName(task: string): string {
    const words = task.toLowerCase().split(' ');
    const name = words.find((w) => w.length > 3) || 'service';
    return `${name}-service`;
  }

  private generateServiceTemplate(serviceName: string, task: string): string {
    const className = serviceName
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');

    return `/**
 * ${className}
 * Generated for: ${task}
 */

export class ${className} {
  constructor() {
    // Initialize service
  }

  async execute(input: unknown): Promise<unknown> {
    try {
      // TODO: Implement ${task}
      return { success: true };
    } catch (error) {
      throw new Error(\`${className} failed: \${error.message}\`);
    }
  }
}

export const ${serviceName.replace(/-/g, '')} = new ${className}();
`;
  }
}
