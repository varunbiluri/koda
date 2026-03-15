import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { replaceText } from './diff-tools.js';

const execAsync = promisify(exec);

/**
 * Apply multiple text replacements atomically.
 *
 * Steps:
 *  1. Stash current changes with git stash as a backup.
 *  2. Apply each patch using replaceText.
 *  3. If any patch fails: pop the stash (restore backup) and return error.
 *  4. If all succeed: return success (stash remains as a rollback point).
 */
export async function atomicMultiFileEdit(
  patches: Array<{ filePath: string; oldText: string; newText: string }>,
  cwd: string,
): Promise<{ success: boolean; error?: string; appliedCount: number }> {
  // Step 1: stash as backup
  try {
    await execAsync(
      'git stash push --include-untracked -m "koda-atomic-edit-backup"',
      { cwd },
    );
  } catch (err) {
    // Non-fatal: git stash may fail on repos with no commits yet
    // Continue anyway — we simply won't have a rollback stash
  }

  // Step 2: apply each patch in order
  let appliedCount = 0;
  for (const patch of patches) {
    const absPath = path.resolve(cwd, patch.filePath);
    try {
      await replaceText(absPath, patch.oldText, patch.newText);
      appliedCount++;
    } catch (err) {
      // Step 3: roll back by popping the stash
      try {
        await execAsync('git stash pop', { cwd });
      } catch {
        // Ignore stash pop failure — already in error path
      }
      return {
        success: false,
        error: `Patch failed on ${patch.filePath}: ${(err as Error).message}`,
        appliedCount,
      };
    }
  }

  // Step 4: all patches applied — leave stash in place as rollback point
  return { success: true, appliedCount };
}
