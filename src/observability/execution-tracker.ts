import type { ExecutionMetrics } from './types.js';
import { eventLogger, EventLogger } from './event-logger.js';

export class ExecutionTracker {
  private startTime: number = 0;
  private metrics: ExecutionMetrics;
  private agentResults: Map<string, boolean> = new Map();
  private modifiedFiles: Set<string> = new Set();
  private eventLogger: EventLogger;

  constructor(logger?: EventLogger) {
    this.eventLogger = logger || eventLogger;
    this.metrics = this.createEmptyMetrics();
  }

  start(): void {
    this.startTime = Date.now();
    this.metrics = this.createEmptyMetrics();
    this.agentResults.clear();
    this.modifiedFiles.clear();
  }

  recordAgentStart(agentName: string): void {
    this.eventLogger.logAgentStarted(agentName);
  }

  recordAgentCompletion(agentName: string, success: boolean): void {
    this.agentResults.set(agentName, success);
    this.metrics.totalAgents++;

    if (success) {
      this.metrics.successfulAgents++;
    } else {
      this.metrics.failedAgents++;
    }

    this.eventLogger.logAgentFinished(agentName, success);
  }

  recordFileModification(filePath: string, agentName?: string): void {
    this.modifiedFiles.add(filePath);
    this.metrics.filesModified = this.modifiedFiles.size;
    this.eventLogger.logFileModified(filePath, agentName);
  }

  recordTestExecution(): void {
    this.metrics.testsRun++;
  }

  recordIteration(iteration: number, success: boolean): void {
    this.metrics.iterations = Math.max(this.metrics.iterations, iteration);

    if (success) {
      this.eventLogger.logIterationCompleted(iteration, true);
    } else {
      this.eventLogger.logIterationCompleted(iteration, false);
    }
  }

  recordTokenUsage(tokens: number): void {
    this.metrics.tokenUsage += tokens;
  }

  recordVerificationStart(): void {
    this.eventLogger.logVerificationStarted();
  }

  recordVerificationResult(passed: boolean, errors?: string[]): void {
    if (passed) {
      this.eventLogger.logVerificationPassed();
    } else {
      this.eventLogger.logVerificationFailed(errors || []);
    }
  }

  recordToolCall(toolName: string, agentName?: string, details?: Record<string, unknown>): void {
    this.eventLogger.logToolCalled(toolName, agentName, details);
  }

  recordBudgetExceeded(agentName: string, details?: Record<string, unknown>): void {
    this.eventLogger.logBudgetExceeded(agentName, details);
  }

  recordLockAcquired(filePath: string, agentName: string): void {
    this.eventLogger.logLockAcquired(filePath, agentName);
  }

  recordLockReleased(filePath: string, agentName: string): void {
    this.eventLogger.logLockReleased(filePath, agentName);
  }

  finish(): ExecutionMetrics {
    this.metrics.totalDuration = Date.now() - this.startTime;
    return { ...this.metrics };
  }

  getMetrics(): ExecutionMetrics {
    return {
      ...this.metrics,
      totalDuration: this.startTime > 0 ? Date.now() - this.startTime : 0,
    };
  }

  getAgentResults(): Map<string, boolean> {
    return new Map(this.agentResults);
  }

  getModifiedFiles(): string[] {
    return Array.from(this.modifiedFiles);
  }

  getSuccessRate(): number {
    if (this.metrics.totalAgents === 0) {
      return 0;
    }

    return this.metrics.successfulAgents / this.metrics.totalAgents;
  }

  formatSummary(): string {
    const metrics = this.getMetrics();
    const durationSec = (metrics.totalDuration / 1000).toFixed(2);

    let summary = 'Execution Summary\n';
    summary += '=================\n\n';

    summary += `Duration: ${durationSec}s\n`;
    summary += `Iterations: ${metrics.iterations}\n\n`;

    summary += 'Agents:\n';
    summary += `  Total: ${metrics.totalAgents}\n`;
    summary += `  Successful: ${metrics.successfulAgents}\n`;
    summary += `  Failed: ${metrics.failedAgents}\n`;

    if (metrics.totalAgents > 0) {
      const successRate = (this.getSuccessRate() * 100).toFixed(1);
      summary += `  Success Rate: ${successRate}%\n`;
    }

    summary += `\nFiles Modified: ${metrics.filesModified}\n`;
    summary += `Tests Run: ${metrics.testsRun}\n`;
    summary += `Token Usage: ${metrics.tokenUsage.toLocaleString()}\n`;

    return summary;
  }

  formatDetailedReport(): string {
    let report = this.formatSummary();

    report += '\n\nAgent Results:\n';
    for (const [agentName, success] of this.agentResults.entries()) {
      const status = success ? '✓' : '✗';
      report += `  ${status} ${agentName}\n`;
    }

    if (this.modifiedFiles.size > 0) {
      report += '\nModified Files:\n';
      for (const file of this.modifiedFiles) {
        report += `  - ${file}\n`;
      }
    }

    report += '\n' + this.eventLogger.generateSummary();

    return report;
  }

  reset(): void {
    this.startTime = 0;
    this.metrics = this.createEmptyMetrics();
    this.agentResults.clear();
    this.modifiedFiles.clear();
  }

  private createEmptyMetrics(): ExecutionMetrics {
    return {
      totalAgents: 0,
      successfulAgents: 0,
      failedAgents: 0,
      iterations: 0,
      filesModified: 0,
      testsRun: 0,
      totalDuration: 0,
      tokenUsage: 0,
    };
  }
}

// Singleton instance
export const executionTracker = new ExecutionTracker();
