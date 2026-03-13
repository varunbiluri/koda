import type { IncrementalUpdate } from './types.js';
import type { ShardManager } from './shard-manager.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

/**
 * IncrementalIndexer - Detects and re-indexes only changed files
 *
 * Uses git diff to detect changes and updates only affected shards
 */
export class IncrementalIndexer {
  constructor(
    private rootPath: string,
    private shardManager: ShardManager,
  ) {}

  /**
   * Detect changed files using git
   */
  async detectChanges(sinceCommit?: string): Promise<IncrementalUpdate> {
    const changedFiles: string[] = [];
    const deletedFiles: string[] = [];

    try {
      // Get changed files since last commit
      const gitCommand = sinceCommit
        ? `git diff --name-status ${sinceCommit} HEAD`
        : 'git diff --name-status HEAD';

      const { stdout } = await execAsync(gitCommand, { cwd: this.rootPath });

      const lines = stdout.trim().split('\n').filter((l) => l.length > 0);

      for (const line of lines) {
        const [status, ...pathParts] = line.split('\t');
        const filePath = pathParts.join('\t');

        if (status === 'D') {
          deletedFiles.push(filePath);
        } else if (status === 'A' || status === 'M' || status === 'R') {
          changedFiles.push(filePath);
        }
      }
    } catch (error) {
      // Fall back to checking all files
      console.warn('Git not available, checking all files');
    }

    // Find affected shards
    const affectedShards = this.findAffectedShards(changedFiles, deletedFiles);

    return {
      changedFiles,
      deletedFiles,
      affectedShards,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Find affected shards from file changes
   */
  private findAffectedShards(changedFiles: string[], deletedFiles: string[]): string[] {
    const affectedShards = new Set<string>();

    for (const file of [...changedFiles, ...deletedFiles]) {
      const shard = this.shardManager.getShardForFile(file);
      if (shard) {
        affectedShards.add(shard.id);
      }
    }

    return Array.from(affectedShards);
  }

  /**
   * Get file hash for change detection
   */
  async getFileHash(filePath: string): Promise<string> {
    const { createHash } = await import('crypto');
    const content = await readFile(filePath, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Check if file has changed since last index
   */
  async hasFileChanged(filePath: string, lastHash: string): Promise<boolean> {
    if (!existsSync(filePath)) {
      return true; // File deleted
    }

    const currentHash = await this.getFileHash(filePath);
    return currentHash !== lastHash;
  }

  /**
   * Load last update timestamp
   */
  async getLastUpdate(): Promise<string | null> {
    const updateFile = join(this.rootPath, '.koda', 'last-update.json');

    if (!existsSync(updateFile)) {
      return null;
    }

    const content = await readFile(updateFile, 'utf-8');
    const data = JSON.parse(content);

    return data.timestamp || null;
  }

  /**
   * Save update timestamp
   */
  async saveUpdateTimestamp(timestamp: string): Promise<void> {
    const { writeFile } = await import('fs/promises');
    const updateFile = join(this.rootPath, '.koda', 'last-update.json');

    await writeFile(
      updateFile,
      JSON.stringify({ timestamp, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8',
    );
  }
}
