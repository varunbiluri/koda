import type { FilePatch, PatchResult } from './types.js';
import { readFile, writeFile } from '../tools/filesystem-tools.js';
import { logger } from '../utils/logger.js';

export class PatchApplier {
  async applyPatch(patch: FilePatch, rootPath: string): Promise<PatchResult> {
    try {
      logger.debug(`Applying patch to ${patch.filePath}`);

      // Verify current content matches expected old content
      const currentResult = await readFile(patch.filePath, rootPath);

      if (currentResult.success && currentResult.data) {
        // File exists - verify it matches old content
        if (currentResult.data !== patch.oldContent) {
          return {
            success: false,
            filePath: patch.filePath,
            error: 'File content has changed since patch was generated',
            applied: false,
          };
        }
      }

      // Apply the patch by writing new content
      const writeResult = await writeFile(patch.filePath, patch.newContent, rootPath);

      if (writeResult.success) {
        return {
          success: true,
          filePath: patch.filePath,
          applied: true,
        };
      } else {
        return {
          success: false,
          filePath: patch.filePath,
          error: writeResult.error,
          applied: false,
        };
      }
    } catch (err) {
      return {
        success: false,
        filePath: patch.filePath,
        error: (err as Error).message,
        applied: false,
      };
    }
  }

  async applyPatches(patches: FilePatch[], rootPath: string): Promise<PatchResult[]> {
    const results: PatchResult[] = [];

    for (const patch of patches) {
      const result = await this.applyPatch(patch, rootPath);
      results.push(result);

      if (!result.success) {
        logger.error(`Failed to apply patch to ${patch.filePath}: ${result.error}`);
      }
    }

    return results;
  }

  async revertPatch(patch: FilePatch, rootPath: string): Promise<PatchResult> {
    try {
      logger.debug(`Reverting patch on ${patch.filePath}`);

      // Restore old content
      const writeResult = await writeFile(patch.filePath, patch.oldContent, rootPath);

      if (writeResult.success) {
        return {
          success: true,
          filePath: patch.filePath,
          applied: false,
        };
      } else {
        return {
          success: false,
          filePath: patch.filePath,
          error: writeResult.error,
          applied: true,
        };
      }
    } catch (err) {
      return {
        success: false,
        filePath: patch.filePath,
        error: (err as Error).message,
        applied: true,
      };
    }
  }
}
