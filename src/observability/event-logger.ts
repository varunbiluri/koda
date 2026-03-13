import type { ExecutionEvent, EventType } from './types.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

export class EventLogger {
  private events: ExecutionEvent[] = [];
  private logFile: string | null = null;
  private maxEventsInMemory: number = 10000;

  constructor() {}

  setLogFile(filePath: string): void {
    this.logFile = filePath;
  }

  logEvent(type: EventType, details?: Partial<Omit<ExecutionEvent, 'type' | 'timestamp'>>): void {
    const event: ExecutionEvent = {
      type,
      timestamp: new Date(),
      ...details,
    };

    this.events.push(event);

    // Trim in-memory events if exceeding limit
    if (this.events.length > this.maxEventsInMemory) {
      this.events.shift();
    }

    logger.debug(`Event logged: ${type}`, details);
  }

  logAgentStarted(agentName: string, details?: Record<string, unknown>): void {
    this.logEvent('agent_started', { agentName, details });
  }

  logAgentFinished(agentName: string, success: boolean, details?: Record<string, unknown>): void {
    this.logEvent('agent_finished', {
      agentName,
      details: { ...details, success },
    });
  }

  logToolCalled(toolName: string, agentName?: string, details?: Record<string, unknown>): void {
    this.logEvent('tool_called', { toolName, agentName, details });
  }

  logFileModified(filePath: string, agentName?: string, details?: Record<string, unknown>): void {
    this.logEvent('file_modified', { filePath, agentName, details });
  }

  logVerificationStarted(details?: Record<string, unknown>): void {
    this.logEvent('verification_started', { details });
  }

  logVerificationPassed(details?: Record<string, unknown>): void {
    this.logEvent('verification_passed', { details });
  }

  logVerificationFailed(errors: string[], details?: Record<string, unknown>): void {
    this.logEvent('verification_failed', {
      details: { ...details, errors },
    });
  }

  logIterationStarted(iteration: number, details?: Record<string, unknown>): void {
    this.logEvent('iteration_started', {
      details: { ...details, iteration },
    });
  }

  logIterationCompleted(iteration: number, success: boolean, details?: Record<string, unknown>): void {
    this.logEvent('iteration_completed', {
      details: { ...details, iteration, success },
    });
  }

  logBudgetExceeded(agentName: string, details?: Record<string, unknown>): void {
    this.logEvent('budget_exceeded', { agentName, details });
  }

  logLockAcquired(filePath: string, agentName: string): void {
    this.logEvent('lock_acquired', { filePath, agentName });
  }

  logLockReleased(filePath: string, agentName: string): void {
    this.logEvent('lock_released', { filePath, agentName });
  }

  getEvents(): ExecutionEvent[] {
    return [...this.events];
  }

  getEventsByType(type: EventType): ExecutionEvent[] {
    return this.events.filter(e => e.type === type);
  }

  getEventsByAgent(agentName: string): ExecutionEvent[] {
    return this.events.filter(e => e.agentName === agentName);
  }

  getEventsSince(timestamp: Date): ExecutionEvent[] {
    return this.events.filter(e => e.timestamp >= timestamp);
  }

  getEventStats(): {
    totalEvents: number;
    eventsByType: Map<EventType, number>;
    eventsByAgent: Map<string, number>;
  } {
    const eventsByType = new Map<EventType, number>();
    const eventsByAgent = new Map<string, number>();

    for (const event of this.events) {
      eventsByType.set(event.type, (eventsByType.get(event.type) || 0) + 1);

      if (event.agentName) {
        eventsByAgent.set(event.agentName, (eventsByAgent.get(event.agentName) || 0) + 1);
      }
    }

    return {
      totalEvents: this.events.length,
      eventsByType,
      eventsByAgent,
    };
  }

  async saveToFile(filePath?: string): Promise<void> {
    const targetFile = filePath || this.logFile;

    if (!targetFile) {
      throw new Error('No log file specified');
    }

    try {
      const data = JSON.stringify(this.events, null, 2);
      await fs.writeFile(targetFile, data, 'utf-8');
      logger.info(`Saved ${this.events.length} events to ${targetFile}`);
    } catch (err) {
      logger.error(`Failed to save events: ${(err as Error).message}`);
      throw err;
    }
  }

  async loadFromFile(filePath: string): Promise<void> {
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      // Convert timestamp strings back to Dates
      this.events = parsed.map((e: any) => ({
        ...e,
        timestamp: new Date(e.timestamp),
      }));

      logger.info(`Loaded ${this.events.length} events from ${filePath}`);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        logger.debug(`Event log file not found: ${filePath}`);
        this.events = [];
      } else {
        logger.error(`Failed to load events: ${err.message}`);
        throw err;
      }
    }
  }

  clear(): void {
    this.events = [];
    logger.debug('Event log cleared');
  }

  generateSummary(): string {
    const stats = this.getEventStats();

    let summary = `Event Summary (${stats.totalEvents} total events)\n\n`;

    summary += 'Events by Type:\n';
    for (const [type, count] of Array.from(stats.eventsByType.entries()).sort((a, b) => b[1] - a[1])) {
      summary += `  ${type}: ${count}\n`;
    }

    if (stats.eventsByAgent.size > 0) {
      summary += '\nEvents by Agent:\n';
      for (const [agent, count] of Array.from(stats.eventsByAgent.entries()).sort((a, b) => b[1] - a[1])) {
        summary += `  ${agent}: ${count}\n`;
      }
    }

    return summary;
  }
}

// Singleton instance
export const eventLogger = new EventLogger();
