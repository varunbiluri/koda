import type { Task, ExecutionPlan } from '../agents/types.js';
import type { WorkspaceMemory } from '../memory/workspace-memory.js';
import { TaskBreakdownAgent } from '../agents/planning/task-breakdown-agent.js';

export class TaskDecomposer {
  private breakdownAgent: TaskBreakdownAgent;

  constructor() {
    this.breakdownAgent = new TaskBreakdownAgent();
  }

  async decompose(userTask: string, memory: WorkspaceMemory): Promise<ExecutionPlan> {
    // Use the task-breakdown agent to create subtasks
    const result = await this.breakdownAgent.execute(
      { task: userTask },
      memory,
    );

    let tasks: Task[];

    if (result.success && result.result) {
      tasks = result.result as Task[];
    } else {
      // Fallback to simple decomposition
      tasks = this.createFallbackTasks(userTask);
    }

    // Organize into execution waves
    const waves = this.createExecutionWaves(tasks);

    return {
      tasks,
      waves,
      estimatedDuration: this.estimateDuration(tasks),
    };
  }

  private createFallbackTasks(userTask: string): Task[] {
    return [
      {
        id: 'analyze',
        description: 'Analyze requirements and repository',
        type: 'planning',
        priority: 10,
        dependencies: [],
        status: 'pending',
      },
      {
        id: 'implement',
        description: `Implement: ${userTask}`,
        type: 'coding',
        priority: 8,
        dependencies: ['analyze'],
        status: 'pending',
      },
      {
        id: 'test',
        description: 'Create and run tests',
        type: 'testing',
        priority: 6,
        dependencies: ['implement'],
        status: 'pending',
      },
      {
        id: 'review',
        description: 'Review and optimize code',
        type: 'review',
        priority: 4,
        dependencies: ['test'],
        status: 'pending',
      },
    ];
  }

  private createExecutionWaves(tasks: Task[]): Task[][] {
    const waves: Task[][] = [];
    const completed = new Set<string>();
    let remainingTasks = [...tasks];

    while (remainingTasks.length > 0) {
      // Find tasks with all dependencies met
      const readyTasks = remainingTasks.filter((task) =>
        task.dependencies.every((dep) => completed.has(dep)),
      );

      if (readyTasks.length === 0) {
        // Break circular dependencies by taking the highest priority task
        const nextTask = remainingTasks.sort((a, b) => b.priority - a.priority)[0];
        if (nextTask) {
          readyTasks.push(nextTask);
        } else {
          break;
        }
      }

      waves.push(readyTasks);
      readyTasks.forEach((task) => completed.add(task.id));
      remainingTasks = remainingTasks.filter((task) => !completed.has(task.id));
    }

    return waves;
  }

  private estimateDuration(tasks: Task[]): number {
    // Simple estimation: 2 minutes per task
    return tasks.length * 2;
  }
}
