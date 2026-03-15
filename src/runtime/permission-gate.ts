import * as readline from 'node:readline';
import { logger } from '../utils/logger.js';

// ── PermissionLevel ───────────────────────────────────────────────────────────

export enum PermissionLevel {
  /** Execute automatically without prompting. */
  ALLOW = 'ALLOW',
  /** Pause and ask the user for explicit approval. */
  ASK   = 'ASK',
  /** Block unconditionally — never execute. */
  DENY  = 'DENY',
}

// ── Rule tables ───────────────────────────────────────────────────────────────

/** Commands that are always blocked — dangerous system-level operations. */
const DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,   // rm -rf
  /\brm\s+-r\b/i,
  /\bsudo\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bpoweroff\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bcurl\s+.*\|\s*(ba)?sh\b/i,
  /\bwget\s+.*-O\s*-.*\|\s*(ba)?sh\b/i,
  /\bgit\s+push\s+.*--force\b/,
  /\bgit\s+reset\s+--hard\b/,
];

/** Operations (tool names or command patterns) that require explicit user approval. */
const ASK_PATTERNS: RegExp[] = [
  // Write operations
  /^write_file$/,
  /^edit_file$/,
  /^apply_patch$/,
  /^replace_text$/,
  /^insert_after_pattern$/,
  // Git mutations
  /^git_commit$/,
  /^git_push$/,
  /^git_add$/,
  /^git_create_pr$/,
  /^koda_commit$/,
  // Terminal execution
  /^run_terminal$/,
];

/** Read-only operations that are always auto-allowed. */
const ALLOW_PATTERNS: RegExp[] = [
  /^read_file$/,
  /^search_code$/,
  /^list_files$/,
  /^search_files$/,
  /^grep_code$/,
  /^list_directory$/,
  /^git_branch$/,
  /^git_status$/,
  /^git_diff$/,
  /^git_log$/,
  /^fetch_url$/,
];

// ── PermissionGate ────────────────────────────────────────────────────────────

/**
 * PermissionGate — tiered consent model for tool and command execution.
 *
 * Before executing any operation:
 *   1. Check DENY_PATTERNS → block unconditionally.
 *   2. Check ALLOW_PATTERNS → proceed automatically.
 *   3. Check ASK_PATTERNS  → prompt the user in interactive mode.
 *   4. Default to ASK for unknown operations (safe fallback).
 *
 * In non-interactive mode (CI, pipes) all ASK operations are auto-approved.
 */
export class PermissionGate {
  /** Bypass confirmation for the current session (set via /trust or --yes flag). */
  private sessionTrust = false;

  /**
   * Classify an operation.
   *
   * @param operation - Tool name (e.g. `"write_file"`) or shell command.
   */
  check(operation: string): PermissionLevel {
    // DENY always wins
    if (DENY_PATTERNS.some((p) => p.test(operation))) {
      logger.debug(`[permission-gate] DENY  "${operation}"`);
      return PermissionLevel.DENY;
    }

    // Explicit allow (read-only tools)
    if (ALLOW_PATTERNS.some((p) => p.test(operation))) {
      logger.debug(`[permission-gate] ALLOW "${operation}"`);
      return PermissionLevel.ALLOW;
    }

    // Explicit ASK (write / git / terminal tools)
    if (ASK_PATTERNS.some((p) => p.test(operation))) {
      logger.debug(`[permission-gate] ASK   "${operation}"`);
      return PermissionLevel.ASK;
    }

    // Unknown operation — default to ASK for safety
    logger.debug(`[permission-gate] ASK   "${operation}" (default — unknown operation)`);
    return PermissionLevel.ASK;
  }

  /**
   * Gate an operation: returns `true` if allowed to proceed.
   *
   *  - DENY  → always returns false (logs a warning).
   *  - ALLOW → always returns true (no prompt).
   *  - ASK   → prompts the user interactively; auto-approves in non-TTY mode
   *            or when session trust has been granted.
   */
  async requestApproval(operation: string, detail?: string): Promise<boolean> {
    const level = this.check(operation);

    if (level === PermissionLevel.DENY) {
      logger.warn(`[permission-gate] Blocked: "${operation}"`);
      return false;
    }

    if (level === PermissionLevel.ALLOW) {
      return true;
    }

    // ASK — skip prompt if not a TTY or session trust is active
    if (this.sessionTrust || !process.stdin.isTTY) {
      return true;
    }

    return this._prompt(operation, detail);
  }

  /**
   * Grant blanket trust for the remainder of this session.
   * Equivalent to --yes / --no-confirm flags.
   */
  grantSessionTrust(): void {
    this.sessionTrust = true;
    logger.info('[permission-gate] Session trust granted — all ASK operations auto-approved');
  }

  /** Returns true if session trust is currently active. */
  hasSessionTrust(): boolean {
    return this.sessionTrust;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _prompt(operation: string, detail?: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
      });

      const detailStr = detail ? `\n  ${detail}` : '';
      rl.question(
        `\n  [Koda] Allow operation: ${operation}${detailStr}\n  Proceed? [Y/n] `,
        (answer) => {
          rl.close();
          const trimmed = answer.trim().toLowerCase();
          const approved = trimmed === '' || trimmed === 'y' || trimmed === 'yes';
          logger.debug(`[permission-gate] User ${approved ? 'approved' : 'denied'}: "${operation}"`);
          resolve(approved);
        },
      );
    });
  }
}

/** Shared singleton for the current process (used by ToolRegistry). */
export const permissionGate = new PermissionGate();
