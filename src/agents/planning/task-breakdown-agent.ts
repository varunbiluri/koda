import { BaseAgent } from '../base-agent.js';
import type { AgentInput, AgentOutput, Task } from '../types.js';
import type { WorkspaceMemory } from '../../memory/workspace-memory.js';

export class TaskBreakdownAgent extends BaseAgent {
  constructor() {
    super(
      'task-breakdown-agent',
      'planning',
      'Breaks down complex tasks into smaller, manageable subtasks',
    );
  }

  async execute(input: AgentInput, memory: WorkspaceMemory): Promise<AgentOutput> {
    try {
      memory.info(`Breaking down task: ${input.task}`, this.name);

      const analysis = await this.useAI(
        `Break down this development task into specific, actionable subtasks: "${input.task}".
        For each subtask, specify:
        1. What needs to be done
        2. Which files/modules are involved
        3. Dependencies on other subtasks
        4. Priority (high/medium/low)`,
        memory,
      );

      if (!analysis) {
        // Fallback to rule-based breakdown
        return this.ruleBasedBreakdown(input.task, memory);
      }

      const tasks = this.parseTasksFromAnalysis(analysis);
      memory.setContext('subtasks', tasks);

      return this.success(tasks, {
        suggestions: [`Created ${tasks.length} subtasks from breakdown`],
      });
    } catch (err) {
      return this.failure((err as Error).message);
    }
  }

  private parseTasksFromAnalysis(analysis: string): Task[] {
    const tasks: Task[] = [];
    const lines = analysis.split('\n');
    let taskId = 1;

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.match(/^\d+\./) ||
        trimmed.match(/^-\s+/) ||
        trimmed.match(/^\*\s+/)
      ) {
        const description = trimmed.replace(/^[\d\.\-\*\s]+/, '').trim();
        if (description.length > 10) {
          tasks.push({
            id: `task-${taskId++}`,
            description,
            type: this.inferTaskType(description),
            priority: this.inferPriority(description),
            dependencies: [],
            status: 'pending',
          });
        }
      }
    }

    return tasks.length > 0 ? tasks : this.createDefaultTasks();
  }

  private inferTaskType(description: string): string {
    const lower = description.toLowerCase();
    if (lower.includes('test')) return 'testing';
    if (lower.includes('implement') || lower.includes('create')) return 'coding';
    if (lower.includes('fix') || lower.includes('debug')) return 'debugging';
    if (lower.includes('review') || lower.includes('optimize')) return 'review';
    return 'coding';
  }

  private inferPriority(description: string): number {
    const lower = description.toLowerCase();
    if (lower.includes('critical') || lower.includes('first')) return 10;
    if (lower.includes('important') || lower.includes('core')) return 7;
    if (lower.includes('optional') || lower.includes('nice')) return 3;
    return 5;
  }

  private ruleBasedBreakdown(task: string, memory: WorkspaceMemory): AgentOutput {
    const tasks = this.createDefaultTasks();
    memory.setContext('subtasks', tasks);
    return this.success(tasks);
  }

  private createDefaultTasks(): Task[] {
    return [
      {
        id: 'task-1',
        description: 'Analyze requirements and design approach',
        type: 'planning',
        priority: 10,
        dependencies: [],
        status: 'pending',
      },
      {
        id: 'task-2',
        description: 'Implement core functionality',
        type: 'coding',
        priority: 8,
        dependencies: ['task-1'],
        status: 'pending',
      },
      {
        id: 'task-3',
        description: 'Write tests',
        type: 'testing',
        priority: 6,
        dependencies: ['task-2'],
        status: 'pending',
      },
      {
        id: 'task-4',
        description: 'Review and optimize',
        type: 'review',
        priority: 4,
        dependencies: ['task-3'],
        status: 'pending',
      },
    ];
  }
}
