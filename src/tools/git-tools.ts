import { runTerminal } from './terminal-tools.js';
import type { ToolResult } from './types.js';

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
