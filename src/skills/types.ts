/**
 * Skill library types - Reusable solution patterns
 */

export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  pattern: SkillPattern;
  examples: SkillExample[];
  tags: string[];
  useCount: number;
  successRate: number;
  createdAt: string;
  lastUsed?: string;
}

export type SkillCategory =
  | 'authentication'
  | 'api'
  | 'database'
  | 'testing'
  | 'ui'
  | 'deployment'
  | 'optimization'
  | 'error-handling'
  | 'general';

export interface SkillPattern {
  type: 'code-template' | 'file-structure' | 'configuration' | 'workflow';
  template: string;
  variables: SkillVariable[];
  steps: string[];
}

export interface SkillVariable {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  default?: unknown;
  required: boolean;
}

export interface SkillExample {
  task: string;
  variables: Record<string, unknown>;
  result: string;
  success: boolean;
}

export interface SkillMatch {
  skill: Skill;
  score: number;
  reasoning: string;
}

export interface SkillExecution {
  skillId: string;
  task: string;
  variables: Record<string, unknown>;
  result: string;
  success: boolean;
  executedAt: string;
  duration: number;
}
