import * as path from 'node:path';
import { CommandExecutor, type CommandOptions, type CommandResult } from './command-executor.js';

/** Categories of commands that require extra safety scrutiny. */
export type CommandRisk = 'safe' | 'elevated' | 'blocked';

/**
 * Patterns that are always blocked regardless of context.
 * These mirror the patterns in ToolRegistry but act as a second layer of
 * defence inside the execution runtime.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
  /\brm\s+-r\b/i,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-z]*f/,
  /\bgit\s+push\s+.*--force\b/,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\b:>\s*\//,
  /\bchmod\s+777\b/,
  /\bsudo\b/i,
  /\bkill\s+-9\b/,
  /\bcurl\s+.*\|\s*(ba)?sh\b/i,   // curl | bash
  /\bwget\s+.*-O\s*-.*\|\s*(ba)?sh\b/i,
];

export interface SandboxResult extends CommandResult {
  /** Risk category assigned to the command before execution. */
  risk: CommandRisk;
  /** Command as submitted (before any normalization). */
  command: string;
}

/**
 * SandboxManager — safe wrapper around CommandExecutor.
 *
 * Responsibilities:
 *   1. Classify command risk (safe / elevated / blocked).
 *   2. Enforce working-directory containment — the cwd must be inside rootPath.
 *   3. Delegate execution to CommandExecutor with the filtered environment.
 *   4. Return structured results including risk metadata.
 */
export class SandboxManager {
  private executor: CommandExecutor;

  constructor(private readonly rootPath: string) {
    this.executor = new CommandExecutor(rootPath);
  }

  // ── Risk classification ────────────────────────────────────────────────────

  classifyRisk(command: string): CommandRisk {
    if (BLOCKED_PATTERNS.some((p) => p.test(command))) return 'blocked';

    // Elevated: commands that write outside the repo or start network listeners
    if (
      /\b(apt|brew|pip|npm install -g|pnpm add -g)\b/i.test(command) ||
      /\bnc\b.*-l/i.test(command)
    ) {
      return 'elevated';
    }

    return 'safe';
  }

  // ── Path containment ───────────────────────────────────────────────────────

  /**
   * Validate that a working directory is inside the repository root.
   * Throws if the path would escape the sandbox boundary.
   */
  assertCwdSafe(cwd: string): void {
    const abs = path.resolve(cwd);
    const root = path.resolve(this.rootPath);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(
        `Sandboxed command refused: cwd "${cwd}" is outside repository root "${this.rootPath}".`,
      );
    }
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  async execute(command: string, options: CommandOptions = {}): Promise<SandboxResult> {
    const risk = this.classifyRisk(command);

    if (risk === 'blocked') {
      return {
        stdout:     '',
        stderr:     `Sandboxed command refused: "${command}" matches a blocked pattern.`,
        exitCode:   1,
        timedOut:   false,
        durationMs: 0,
        risk,
        command,
      };
    }

    const cwd = options.cwd ?? this.rootPath;
    this.assertCwdSafe(cwd);

    const result = await this.executor.run(command, { ...options, cwd });
    return { ...result, risk, command };
  }
}
