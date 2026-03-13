import type { ExecutionRecord, ExecutionPattern, LearningInsight } from './types.js';
import type { ExecutionHistoryStore } from './execution-history-store.js';
import { logger } from '../../utils/logger.js';

export class LearningEngine {
  private historyStore: ExecutionHistoryStore;
  private minOccurrencesForPattern: number = 3;

  constructor(historyStore: ExecutionHistoryStore) {
    this.historyStore = historyStore;
  }

  async analyzePatterns(): Promise<ExecutionPattern[]> {
    const records = await this.historyStore.loadRecords();

    if (records.length < this.minOccurrencesForPattern) {
      return [];
    }

    // Group records by task type (extracted from task description)
    const taskTypeGroups = this.groupByTaskType(records);

    const patterns: ExecutionPattern[] = [];

    for (const [taskType, groupRecords] of taskTypeGroups.entries()) {
      if (groupRecords.length < this.minOccurrencesForPattern) {
        continue;
      }

      const successfulRecords = groupRecords.filter(r => r.success);
      const successfulAgents = this.extractSuccessfulAgents(successfulRecords);
      const commonErrors = this.extractCommonErrors(groupRecords);

      const totalAttempts = groupRecords.reduce((sum, r) => sum + r.verificationAttempts, 0);
      const averageAttempts = totalAttempts / groupRecords.length;

      patterns.push({
        taskType,
        successfulAgents,
        commonErrors,
        averageAttempts,
        successRate: successfulRecords.length / groupRecords.length,
      });
    }

    return patterns.sort((a, b) => b.successRate - a.successRate);
  }

  async generateInsights(): Promise<LearningInsight[]> {
    const patterns = await this.analyzePatterns();
    const records = await this.historyStore.loadRecords();

    const insights: LearningInsight[] = [];

    // Insight 1: High-performing agent combinations
    const agentCombinations = this.analyzeAgentCombinations(records);
    for (const [combo, stats] of agentCombinations.entries()) {
      if (stats.successRate > 0.8 && stats.count >= this.minOccurrencesForPattern) {
        insights.push({
          pattern: `Agent combination: ${combo}`,
          recommendation: `Use agents [${combo}] for similar tasks (${(stats.successRate * 100).toFixed(0)}% success rate)`,
          confidence: Math.min(stats.successRate, stats.count / 10),
          occurrences: stats.count,
        });
      }
    }

    // Insight 2: Common failure patterns
    const failurePatterns = this.analyzeFailurePatterns(records);
    for (const [error, count] of failurePatterns.entries()) {
      if (count >= this.minOccurrencesForPattern) {
        insights.push({
          pattern: `Common error: ${error}`,
          recommendation: this.generateErrorRecommendation(error),
          confidence: Math.min(count / records.length, 0.9),
          occurrences: count,
        });
      }
    }

    // Insight 3: Optimal verification attempt counts
    for (const pattern of patterns) {
      if (pattern.averageAttempts > 3) {
        insights.push({
          pattern: `High verification attempts for: ${pattern.taskType}`,
          recommendation: `Consider reviewing agent logic for ${pattern.taskType} tasks (avg ${pattern.averageAttempts.toFixed(1)} attempts)`,
          confidence: 0.7,
          occurrences: 1,
        });
      }
    }

    // Insight 4: File hotspots
    const fileHotspots = await this.analyzeFileHotspots(records);
    for (const [file, data] of fileHotspots.entries()) {
      if (data.modifications >= 5 && data.failureRate > 0.3) {
        insights.push({
          pattern: `High-risk file: ${file}`,
          recommendation: `File ${file} has high failure rate (${(data.failureRate * 100).toFixed(0)}%) - consider refactoring or adding validation`,
          confidence: Math.min(data.modifications / 10, 0.9),
          occurrences: data.modifications,
        });
      }
    }

    return insights.sort((a, b) => b.confidence - a.confidence);
  }

  async getSuggestedAgents(taskDescription: string): Promise<string[]> {
    const patterns = await this.analyzePatterns();

    // Find matching patterns
    const matchingPatterns = patterns.filter(p =>
      taskDescription.toLowerCase().includes(p.taskType.toLowerCase()) ||
      p.taskType.toLowerCase().includes(taskDescription.toLowerCase())
    );

    if (matchingPatterns.length === 0) {
      return [];
    }

    // Return agents from highest success rate pattern
    const bestPattern = matchingPatterns.reduce((best, current) =>
      current.successRate > best.successRate ? current : best
    );

    return bestPattern.successfulAgents;
  }

  async getCommonPitfalls(taskType: string): Promise<string[]> {
    const patterns = await this.analyzePatterns();

    const matchingPattern = patterns.find(p =>
      p.taskType.toLowerCase() === taskType.toLowerCase()
    );

    return matchingPattern?.commonErrors || [];
  }

  private groupByTaskType(records: ExecutionRecord[]): Map<string, ExecutionRecord[]> {
    const groups = new Map<string, ExecutionRecord[]>();

    for (const record of records) {
      // Extract task type from task description (e.g., "fix", "refactor", "build")
      const taskType = this.extractTaskType(record.task);

      if (!groups.has(taskType)) {
        groups.set(taskType, []);
      }

      groups.get(taskType)!.push(record);
    }

    return groups;
  }

  private extractTaskType(task: string): string {
    const lower = task.toLowerCase();

    // Common task types
    if (lower.includes('fix') || lower.includes('bug')) return 'fix';
    if (lower.includes('refactor')) return 'refactor';
    if (lower.includes('build') || lower.includes('compile')) return 'build';
    if (lower.includes('test')) return 'test';
    if (lower.includes('optimize')) return 'optimize';
    if (lower.includes('implement') || lower.includes('add')) return 'implement';
    if (lower.includes('update') || lower.includes('modify')) return 'update';

    return 'general';
  }

  private extractSuccessfulAgents(records: ExecutionRecord[]): string[] {
    const agentSuccessCounts = new Map<string, number>();

    for (const record of records) {
      for (const agent of record.agentsUsed) {
        agentSuccessCounts.set(agent, (agentSuccessCounts.get(agent) || 0) + 1);
      }
    }

    // Return agents sorted by success count
    return Array.from(agentSuccessCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([agent]) => agent);
  }

  private extractCommonErrors(records: ExecutionRecord[]): string[] {
    const errorCounts = new Map<string, number>();

    for (const record of records) {
      for (const error of record.errors) {
        // Normalize error message
        const normalized = this.normalizeError(error);
        errorCounts.set(normalized, (errorCounts.get(normalized) || 0) + 1);
      }
    }

    // Return errors that occurred in at least 20% of records
    const threshold = records.length * 0.2;
    return Array.from(errorCounts.entries())
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([error]) => error);
  }

  private normalizeError(error: string): string {
    // Extract core error message (remove file paths, line numbers, etc.)
    return error
      .replace(/\/[^\s]+/g, '<path>')  // Replace paths
      .replace(/:\d+:\d+/g, '')  // Remove line:column
      .replace(/\d+/g, '<num>')  // Replace numbers
      .slice(0, 200);  // Limit length
  }

  private analyzeAgentCombinations(records: ExecutionRecord[]): Map<string, { count: number; successRate: number }> {
    const combinations = new Map<string, { successes: number; total: number }>();

    for (const record of records) {
      const combo = record.agentsUsed.sort().join(', ');

      if (!combinations.has(combo)) {
        combinations.set(combo, { successes: 0, total: 0 });
      }

      const stats = combinations.get(combo)!;
      stats.total++;
      if (record.success) {
        stats.successes++;
      }
    }

    // Convert to success rate
    const result = new Map<string, { count: number; successRate: number }>();
    for (const [combo, stats] of combinations.entries()) {
      result.set(combo, {
        count: stats.total,
        successRate: stats.successes / stats.total,
      });
    }

    return result;
  }

  private analyzeFailurePatterns(records: ExecutionRecord[]): Map<string, number> {
    const failedRecords = records.filter(r => !r.success);
    const errorCounts = new Map<string, number>();

    for (const record of failedRecords) {
      for (const error of record.errors) {
        const normalized = this.normalizeError(error);
        errorCounts.set(normalized, (errorCounts.get(normalized) || 0) + 1);
      }
    }

    return errorCounts;
  }

  private async analyzeFileHotspots(
    records: ExecutionRecord[]
  ): Promise<Map<string, { modifications: number; failures: number; failureRate: number }>> {
    const fileStats = new Map<string, { modifications: number; failures: number }>();

    for (const record of records) {
      for (const file of record.filesModified) {
        if (!fileStats.has(file)) {
          fileStats.set(file, { modifications: 0, failures: 0 });
        }

        const stats = fileStats.get(file)!;
        stats.modifications++;
        if (!record.success) {
          stats.failures++;
        }
      }
    }

    // Calculate failure rates
    const result = new Map<string, { modifications: number; failures: number; failureRate: number }>();
    for (const [file, stats] of fileStats.entries()) {
      result.set(file, {
        ...stats,
        failureRate: stats.failures / stats.modifications,
      });
    }

    return result;
  }

  private generateErrorRecommendation(error: string): string {
    const lower = error.toLowerCase();

    if (lower.includes('type') || lower.includes('ts')) {
      return 'Run type checking before verification to catch TypeScript errors early';
    }

    if (lower.includes('test')) {
      return 'Ensure tests are updated alongside code changes';
    }

    if (lower.includes('lint')) {
      return 'Run linter before committing changes';
    }

    if (lower.includes('import') || lower.includes('module')) {
      return 'Check import paths and module resolution';
    }

    if (lower.includes('undefined') || lower.includes('null')) {
      return 'Add null/undefined checks and proper error handling';
    }

    return 'Review error logs and adjust agent approach';
  }
}
