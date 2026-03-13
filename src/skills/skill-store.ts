import type { Skill, SkillExecution } from './types.js';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * SkillStore - Persists skills and execution history to .koda/skills/
 */
export class SkillStore {
  private skillsDir: string;
  private executionsFile: string;

  constructor(kodaDir: string) {
    this.skillsDir = join(kodaDir, 'skills');
    this.executionsFile = join(this.skillsDir, 'executions.json');
  }

  /**
   * Save a skill to disk
   */
  async saveSkill(skill: Skill): Promise<void> {
    await this.ensureSkillsDir();

    const skillFile = join(this.skillsDir, `${skill.id}.json`);
    await writeFile(skillFile, JSON.stringify(skill, null, 2), 'utf-8');
  }

  /**
   * Load a skill from disk
   */
  async loadSkill(skillId: string): Promise<Skill | null> {
    const skillFile = join(this.skillsDir, `${skillId}.json`);

    if (!existsSync(skillFile)) {
      return null;
    }

    const content = await readFile(skillFile, 'utf-8');
    return JSON.parse(content) as Skill;
  }

  /**
   * Load all skills
   */
  async loadAllSkills(): Promise<Skill[]> {
    await this.ensureSkillsDir();

    const files = await readdir(this.skillsDir);
    const skills: Skill[] = [];

    for (const file of files) {
      if (file.endsWith('.json') && file !== 'executions.json') {
        const skillId = file.replace('.json', '');
        const skill = await this.loadSkill(skillId);
        if (skill) skills.push(skill);
      }
    }

    return skills;
  }

  /**
   * Record skill execution
   */
  async recordExecution(execution: SkillExecution): Promise<void> {
    await this.ensureSkillsDir();

    let executions: SkillExecution[] = [];

    if (existsSync(this.executionsFile)) {
      const content = await readFile(this.executionsFile, 'utf-8');
      executions = JSON.parse(content);
    }

    executions.push(execution);

    // Keep last 1000 executions
    if (executions.length > 1000) {
      executions = executions.slice(-1000);
    }

    await writeFile(this.executionsFile, JSON.stringify(executions, null, 2), 'utf-8');
  }

  /**
   * Get execution history for a skill
   */
  async getExecutionHistory(skillId: string): Promise<SkillExecution[]> {
    if (!existsSync(this.executionsFile)) {
      return [];
    }

    const content = await readFile(this.executionsFile, 'utf-8');
    const executions: SkillExecution[] = JSON.parse(content);

    return executions.filter((e) => e.skillId === skillId);
  }

  /**
   * Ensure skills directory exists
   */
  private async ensureSkillsDir(): Promise<void> {
    if (!existsSync(this.skillsDir)) {
      await mkdir(this.skillsDir, { recursive: true });
    }
  }
}
