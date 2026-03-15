import { runTerminal } from './terminal-tools.js';
import type { ToolResult } from './types.js';

export const KODA_AUTHOR = 'Koda AI <268287658+koda-ai-engineer@users.noreply.github.com>';

/** GitHub-recognized co-author trailer. Must be the final line of the commit message. */
export const KODA_CO_AUTHOR_TRAILER =
  'Co-authored-by: Koda AI <268287658+koda-ai-engineer@users.noreply.github.com>';

export async function gitDiff(rootPath: string): Promise<ToolResult<string>> {
  const result = await runTerminal('git diff', rootPath);
  if (result.success && result.data) {
    return { success: true, data: result.data.stdout };
  }
  return { success: false, error: result.error };
}

export async function gitStatus(rootPath: string): Promise<ToolResult<string>> {
  const result = await runTerminal('git status --short', rootPath);
  if (result.success && result.data) {
    return { success: true, data: result.data.stdout };
  }
  return { success: false, error: result.error };
}

export async function gitAdd(filePath: string, rootPath: string): Promise<ToolResult<void>> {
  const result = await runTerminal(`git add "${filePath}"`, rootPath);
  if (result.success) {
    return { success: true };
  }
  return { success: false, error: result.error };
}

export async function gitCommit(message: string, rootPath: string): Promise<ToolResult<string>> {
  const escapedMessage = message.replace(/"/g, '\\"');
  const result = await runTerminal(`git commit -m "${escapedMessage}"`, rootPath);
  if (result.success && result.data) {
    return { success: true, data: result.data.stdout };
  }
  return { success: false, error: result.error };
}

export async function gitLog(count: number, rootPath: string): Promise<ToolResult<string>> {
  const result = await runTerminal(`git log -${count} --oneline`, rootPath);
  if (result.success && result.data) {
    return { success: true, data: result.data.stdout };
  }
  return { success: false, error: result.error };
}

export async function gitBranch(rootPath: string): Promise<ToolResult<string>> {
  const result = await runTerminal('git branch --show-current', rootPath);
  if (result.success && result.data) {
    return { success: true, data: result.data.stdout.trim() };
  }
  return { success: false, error: result.error };
}

export async function gitPush(branch: string, rootPath: string): Promise<ToolResult<string>> {
  const safeBranch = branch.replace(/[^a-zA-Z0-9/_.-]/g, '');
  const result = await runTerminal(`git push origin "${safeBranch}"`, rootPath);
  if (result.success && result.data) {
    return { success: true, data: result.data.stdout || result.data.stderr };
  }
  return { success: false, error: result.error };
}

/**
 * Stage files and create a commit with Koda AI as a co-author.
 *
 * The developer remains the primary Git author. GitHub recognises the
 * "Co-authored-by:" trailer and shows Koda AI in the contributor graph.
 *
 * Commit message format:
 *   <original message>
 *
 *   Generated with help from Koda AI.
 *
 *   Co-authored-by: Koda AI <268287658+koda-ai-engineer@users.noreply.github.com>
 *
 * @returns commit hash (short) and the full commit message used.
 */
export async function createKodaCommit(
  message: string,
  rootPath: string,
  filesToAdd: string[] = ['.'],
): Promise<ToolResult<{ hash: string; message: string }>> {
  // Stage files
  const addArgs = filesToAdd.map((f) => `"${f}"`).join(' ');
  const addResult = await runTerminal(`git add ${addArgs}`, rootPath);
  if (!addResult.success) {
    return { success: false, error: `git add failed: ${addResult.error}` };
  }

  // Build message with co-author trailer as the final line (GitHub requirement)
  const fullMessage =
    `${message}\n\nGenerated with help from Koda AI.\n\n${KODA_CO_AUTHOR_TRAILER}`;

  const escapedMessage = fullMessage.replace(/"/g, '\\"');
  const commitResult = await runTerminal(`git commit -m "${escapedMessage}"`, rootPath);
  if (!commitResult.success) {
    return { success: false, error: `git commit failed: ${commitResult.error}` };
  }

  // Extract short hash
  const hashResult = await runTerminal('git rev-parse --short HEAD', rootPath);
  const hash = hashResult.data?.stdout.trim() ?? 'unknown';

  return { success: true, data: { hash, message: fullMessage } };
}

export async function gitCreatePr(
  title: string,
  body: string,
  rootPath: string,
): Promise<ToolResult<string>> {
  const safeTitle = title.replace(/"/g, '\\"');
  const safeBody = body.replace(/"/g, '\\"');
  const result = await runTerminal(
    `gh pr create --title "${safeTitle}" --body "${safeBody}"`,
    rootPath,
  );
  if (result.success && result.data) {
    return { success: true, data: result.data.stdout.trim() };
  }
  return { success: false, error: result.error };
}
