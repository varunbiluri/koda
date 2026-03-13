import { logger } from '../utils/logger.js';

export class FileLockManager {
  private locks: Map<string, string> = new Map(); // filePath -> agentId
  private lockWaitTimeout: number = 5000; // 5 seconds

  async lockFile(filePath: string, agentId: string): Promise<boolean> {
    const existingLock = this.locks.get(filePath);

    if (existingLock) {
      if (existingLock === agentId) {
        // Already locked by this agent
        return true;
      }

      logger.warn(`File ${filePath} is locked by ${existingLock}, waiting...`);

      // Wait for lock to be released
      const acquired = await this.waitForLock(filePath, agentId);
      return acquired;
    }

    // Acquire lock
    this.locks.set(filePath, agentId);
    logger.debug(`Lock acquired on ${filePath} by ${agentId}`);
    return true;
  }

  unlockFile(filePath: string, agentId: string): boolean {
    const existingLock = this.locks.get(filePath);

    if (!existingLock) {
      // No lock exists
      return true;
    }

    if (existingLock !== agentId) {
      logger.warn(`Agent ${agentId} cannot unlock ${filePath} (locked by ${existingLock})`);
      return false;
    }

    this.locks.delete(filePath);
    logger.debug(`Lock released on ${filePath} by ${agentId}`);
    return true;
  }

  isLocked(filePath: string): boolean {
    return this.locks.has(filePath);
  }

  getLockedBy(filePath: string): string | undefined {
    return this.locks.get(filePath);
  }

  getAllLocks(): Map<string, string> {
    return new Map(this.locks);
  }

  clearAllLocks(): void {
    this.locks.clear();
    logger.debug('All file locks cleared');
  }

  clearLocksForAgent(agentId: string): void {
    const locksToRemove: string[] = [];

    for (const [filePath, owner] of this.locks) {
      if (owner === agentId) {
        locksToRemove.push(filePath);
      }
    }

    for (const filePath of locksToRemove) {
      this.locks.delete(filePath);
    }

    logger.debug(`Cleared ${locksToRemove.length} locks for agent ${agentId}`);
  }

  private async waitForLock(filePath: string, agentId: string): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 100; // Check every 100ms

    while (Date.now() - startTime < this.lockWaitTimeout) {
      await this.sleep(pollInterval);

      const existingLock = this.locks.get(filePath);
      if (!existingLock) {
        // Lock released, acquire it
        this.locks.set(filePath, agentId);
        logger.debug(`Lock acquired on ${filePath} by ${agentId} after waiting`);
        return true;
      }
    }

    // Timeout
    logger.error(`Timeout waiting for lock on ${filePath} for agent ${agentId}`);
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const fileLockManager = new FileLockManager();
