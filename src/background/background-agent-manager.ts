import { EventEmitter } from 'events';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { BackgroundTaskScheduler } from './background-task-scheduler.js';

export type TriggerCondition = 'onFileSave' | 'onGitCommit' | 'onPullRequest';

export interface AgentDefinition {
  name: string;
  triggers: TriggerCondition[];
  prompt: (files: string[]) => string;
}

export interface AgentResult {
  agentName: string;
  files: string[];
  analysis: string;
  timestamp: string;
}

const RESULTS_DIR = '.koda/background-results';

const BUILT_IN_AGENTS: AgentDefinition[] = [
  {
    name: 'test-coverage-agent',
    triggers: ['onFileSave', 'onGitCommit'],
    prompt: (files) => `Analyze test coverage for these changed files: ${files.join(', ')}. Identify untested code paths.`,
  },
  {
    name: 'security-scan-agent',
    triggers: ['onFileSave', 'onGitCommit', 'onPullRequest'],
    prompt: (files) => `Perform a security analysis of these files: ${files.join(', ')}. Look for OWASP top 10 vulnerabilities.`,
  },
  {
    name: 'performance-analysis-agent',
    triggers: ['onGitCommit', 'onPullRequest'],
    prompt: (files) => `Analyze performance implications in: ${files.join(', ')}. Identify O(n²) loops, memory leaks, blocking I/O.`,
  },
  {
    name: 'dead-code-agent',
    triggers: ['onGitCommit'],
    prompt: (files) => `Check for dead code and unused exports in: ${files.join(', ')}.`,
  },
];

/**
 * BackgroundAgentManager - Manages background analysis agents.
 */
export class BackgroundAgentManager extends EventEmitter {
  private agents: Map<string, AgentDefinition> = new Map();
  private scheduler: BackgroundTaskScheduler;

  constructor(
    private rootPath: string,
    scheduler?: BackgroundTaskScheduler,
  ) {
    super();
    this.scheduler = scheduler ?? new BackgroundTaskScheduler(2);

    // Register built-in agents
    for (const agent of BUILT_IN_AGENTS) {
      this.register(agent);
    }

    this.scheduler.on('task-started', (task) => this.emit('agent-started', task));
    this.scheduler.on('task-completed', (taskId) => this.emit('agent-completed', taskId));
    this.scheduler.on('task-failed', (info) => this.emit('agent-failed', info));
  }

  register(agent: AgentDefinition): void {
    this.agents.set(agent.name, agent);
  }

  async trigger(condition: TriggerCondition, changedFiles: string[]): Promise<void> {
    const matchingAgents: AgentDefinition[] = [];

    for (const agent of this.agents.values()) {
      if (!agent.triggers.includes(condition)) continue;
      matchingAgents.push(agent);

      for (const filePath of changedFiles) {
        this.scheduler.enqueue({
          agentType: agent.name,
          filePath,
          priority: priorityForCondition(condition),
        });
      }
    }

    await this.executeQueued(matchingAgents, changedFiles);
  }

  private async executeQueued(agents: AgentDefinition[], files: string[]): Promise<void> {
    const resultsDir = join(this.rootPath, RESULTS_DIR);
    if (!existsSync(resultsDir)) {
      await mkdir(resultsDir, { recursive: true });
    }

    for (const agent of agents) {
      const result: AgentResult = {
        agentName: agent.name,
        files,
        analysis: `[${agent.name}] Queued analysis for: ${files.join(', ')}`,
        timestamp: new Date().toISOString(),
      };

      const filename = `${agent.name}-${Date.now()}.json`;
      await writeFile(join(resultsDir, filename), JSON.stringify(result, null, 2));
      this.emit('result', result);
    }
  }

  getScheduler(): BackgroundTaskScheduler {
    return this.scheduler;
  }

  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }
}

function priorityForCondition(condition: TriggerCondition): number {
  switch (condition) {
    case 'onPullRequest': return 10;
    case 'onGitCommit': return 5;
    case 'onFileSave': return 1;
  }
}
