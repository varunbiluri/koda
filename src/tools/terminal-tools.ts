import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolResult } from './types.js';
import { PermissionManager } from '../security/permission-manager.js';

const execAsync = promisify(exec);

export interface TerminalOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runTerminal(
  command: string,
  rootPath: string,
  timeout: number = 30000,
): Promise<ToolResult<TerminalOutput>> {
  const permitted = await PermissionManager.check(command);
  if (!permitted) {
    return {
      success: false,
      error: `Command cancelled by user: ${command}`,
      data: { stdout: '', stderr: '', exitCode: 1 },
    };
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: rootPath,
      timeout,
      maxBuffer: 1024 * 1024 * 10, // 10MB
    });

    return {
      success: true,
      data: {
        stdout,
        stderr,
        exitCode: 0,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Command failed: ${err.message}`,
      data: {
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        exitCode: err.code || 1,
      },
    };
  }
}

export async function runTests(
  rootPath: string,
  testCommand?: string,
): Promise<ToolResult<TerminalOutput>> {
  const command = testCommand || 'npm test';
  return runTerminal(command, rootPath, 60000); // 60s timeout for tests
}

export async function runLinter(
  rootPath: string,
  lintCommand?: string,
): Promise<ToolResult<TerminalOutput>> {
  const command = lintCommand || 'npm run lint';
  return runTerminal(command, rootPath);
}

export async function runBuild(
  rootPath: string,
  buildCommand?: string,
): Promise<ToolResult<TerminalOutput>> {
  const command = buildCommand || 'npm run build';
  return runTerminal(command, rootPath, 120000); // 120s timeout for builds
}
