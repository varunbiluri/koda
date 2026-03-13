import type { ExecutionRecord } from './types.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../../utils/logger.js';

export class ExecutionHistoryStore {
  private historyFile: string;
  private maxRecords: number = 1000;  // Keep last 1000 executions
  private cache: ExecutionRecord[] | null = null;

  constructor(kodaDir: string, maxRecords: number = 1000) {
    this.historyFile = join(kodaDir, 'execution-history.json');
    this.maxRecords = maxRecords;
  }

  async saveRecord(record: ExecutionRecord): Promise<void> {
    try {
      const records = await this.loadRecords();
      records.unshift(record);  // Add to beginning

      // Trim to max records
      if (records.length > this.maxRecords) {
        records.splice(this.maxRecords);
      }

      await this.writeRecords(records);
      this.cache = records;

      logger.debug(`Saved execution record ${record.id}`);
    } catch (err) {
      logger.error(`Failed to save execution record: ${(err as Error).message}`);
      throw err;
    }
  }

  async loadRecords(): Promise<ExecutionRecord[]> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const data = await fs.readFile(this.historyFile, 'utf-8');
      const parsed = JSON.parse(data);

      // Convert timestamp strings back to Dates
      const records = parsed.map((r: any) => ({
        ...r,
        timestamp: new Date(r.timestamp),
      }));

      this.cache = records;
      return records;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // File doesn't exist yet
        return [];
      }

      logger.error(`Failed to load execution history: ${err.message}`);
      return [];
    }
  }

  async getRecordById(id: string): Promise<ExecutionRecord | undefined> {
    const records = await this.loadRecords();
    return records.find(r => r.id === id);
  }

  async getRecentRecords(limit: number = 10): Promise<ExecutionRecord[]> {
    const records = await this.loadRecords();
    return records.slice(0, limit);
  }

  async getRecordsByTask(task: string, limit: number = 10): Promise<ExecutionRecord[]> {
    const records = await this.loadRecords();
    return records
      .filter(r => r.task.toLowerCase().includes(task.toLowerCase()))
      .slice(0, limit);
  }

  async getSuccessfulRecords(limit: number = 100): Promise<ExecutionRecord[]> {
    const records = await this.loadRecords();
    return records
      .filter(r => r.success)
      .slice(0, limit);
  }

  async getFailedRecords(limit: number = 100): Promise<ExecutionRecord[]> {
    const records = await this.loadRecords();
    return records
      .filter(r => !r.success)
      .slice(0, limit);
  }

  async getRecordsByDateRange(startDate: Date, endDate: Date): Promise<ExecutionRecord[]> {
    const records = await this.loadRecords();
    return records.filter(r =>
      r.timestamp >= startDate && r.timestamp <= endDate
    );
  }

  async getStatistics(): Promise<{
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    successRate: number;
    averageDuration: number;
    totalTokensUsed: number;
    mostUsedAgents: Array<{ agent: string; count: number }>;
    mostModifiedFiles: Array<{ file: string; count: number }>;
  }> {
    const records = await this.loadRecords();

    if (records.length === 0) {
      return {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        successRate: 0,
        averageDuration: 0,
        totalTokensUsed: 0,
        mostUsedAgents: [],
        mostModifiedFiles: [],
      };
    }

    const successfulCount = records.filter(r => r.success).length;
    const totalDuration = records.reduce((sum, r) => sum + r.duration, 0);
    const totalTokens = records.reduce((sum, r) => sum + r.totalTokensUsed, 0);

    // Count agent usage
    const agentCounts = new Map<string, number>();
    for (const record of records) {
      for (const agent of record.agentsUsed) {
        agentCounts.set(agent, (agentCounts.get(agent) || 0) + 1);
      }
    }

    // Count file modifications
    const fileCounts = new Map<string, number>();
    for (const record of records) {
      for (const file of record.filesModified) {
        fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
      }
    }

    const mostUsedAgents = Array.from(agentCounts.entries())
      .map(([agent, count]) => ({ agent, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const mostModifiedFiles = Array.from(fileCounts.entries())
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalExecutions: records.length,
      successfulExecutions: successfulCount,
      failedExecutions: records.length - successfulCount,
      successRate: successfulCount / records.length,
      averageDuration: totalDuration / records.length,
      totalTokensUsed: totalTokens,
      mostUsedAgents,
      mostModifiedFiles,
    };
  }

  async clearHistory(): Promise<void> {
    try {
      await fs.unlink(this.historyFile);
      this.cache = null;
      logger.info('Execution history cleared');
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.error(`Failed to clear history: ${err.message}`);
        throw err;
      }
    }
  }

  private async writeRecords(records: ExecutionRecord[]): Promise<void> {
    const data = JSON.stringify(records, null, 2);
    await fs.writeFile(this.historyFile, data, 'utf-8');
  }

  invalidateCache(): void {
    this.cache = null;
  }
}
