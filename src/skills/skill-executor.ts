import type { Skill, SkillExecution } from './types.js';
import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { SkillStore } from './skill-store.js';

/**
 * SkillExecutor - Executes skills by applying templates with variables
 */
export class SkillExecutor {
  private store: SkillStore;

  constructor(kodaDir: string) {
    this.store = new SkillStore(kodaDir);
  }

  /**
   * Execute a skill with given variables
   */
  async execute(
    skill: Skill,
    variables: Record<string, unknown>,
    memory: WorkspaceMemory,
  ): Promise<SkillExecution> {
    const startTime = Date.now();
    memory.info(`Executing skill: ${skill.name}`, 'skill-executor');

    try {
      // Validate variables
      this.validateVariables(skill, variables);

      // Apply template
      const result = this.applyTemplate(skill.pattern.template, variables);

      // Record execution
      const execution: SkillExecution = {
        skillId: skill.id,
        task: `Apply ${skill.name}`,
        variables,
        result,
        success: true,
        executedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      };

      await this.store.recordExecution(execution);

      memory.info(`Skill executed successfully in ${execution.duration}ms`, 'skill-executor');

      return execution;
    } catch (error) {
      memory.error(`Skill execution failed: ${(error as Error).message}`, 'skill-executor');

      const execution: SkillExecution = {
        skillId: skill.id,
        task: `Apply ${skill.name}`,
        variables,
        result: '',
        success: false,
        executedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      };

      await this.store.recordExecution(execution);

      return execution;
    }
  }

  /**
   * Validate that all required variables are provided
   */
  private validateVariables(
    skill: Skill,
    variables: Record<string, unknown>,
  ): void {
    for (const varDef of skill.pattern.variables) {
      if (varDef.required && !(varDef.name in variables)) {
        throw new Error(`Missing required variable: ${varDef.name}`);
      }

      // Apply defaults
      if (!(varDef.name in variables) && varDef.default !== undefined) {
        variables[varDef.name] = varDef.default;
      }
    }
  }

  /**
   * Apply template with variable substitution
   */
  private applyTemplate(
    template: string,
    variables: Record<string, unknown>,
  ): string {
    let result = template;

    // Replace {{variable}} placeholders
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const replacement = String(value);

      result = result.replace(new RegExp(placeholder, 'g'), replacement);
    }

    return result;
  }

  /**
   * Get execution history
   */
  async getHistory(skillId: string): Promise<SkillExecution[]> {
    return this.store.getExecutionHistory(skillId);
  }
}
