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

/**
 * Write/git mutation tools that require explicit user approval.
 *
 * In non-interactive mode (CI, pipes) these are DENIED unless session trust is
 * explicitly granted via grantSessionTrust() / --yes flag. File writes and git
 * mutations must never be auto-approved — they change persistent state.
 */
const WRITE_ASK_PATTERNS: RegExp[] = [
  /^write_file$/,
  /^edit_file$/,
  /^apply_patch$/,
  /^git_commit$/,
  /^git_push$/,
  /^git_add$/,
  /^git_create_pr$/,
  /^koda_commit$/,
];

/**
 * Terminal execution: prompt in interactive mode, auto-allow in non-TTY.
 *
 * run_terminal is guarded at the DENY layer (rm -rf, sudo, git push --force, etc.)
 * for dangerous patterns. Safe commands (pnpm test, ls, cat) should be allowed in
 * CI pipelines without requiring a human at the keyboard.
 */
const TERMINAL_ASK_PATTERNS: RegExp[] = [
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
 * Decision order (first match wins):
 *   1. DENY_PATTERNS       → block unconditionally (dangerous system ops).
 *   2. ALLOW_PATTERNS      → proceed automatically (read-only tools).
 *   3. WRITE_ASK_PATTERNS  → require interactive approval; DENIED in non-TTY
 *                            unless session trust is explicitly granted.
 *   4. TERMINAL_ASK_PATTERNS → prompt in TTY; auto-allowed in non-TTY
 *                              (DENY_PATTERNS already block dangerous commands).
 *   5. Default             → ASK (unknown operations are treated as WRITE-level).
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
    if (DENY_PATTERNS.some((p) => p.test(operation))) {
      logger.debug(`[permission-gate] DENY  "${operation}"`);
      return PermissionLevel.DENY;
    }
    if (ALLOW_PATTERNS.some((p) => p.test(operation))) {
      logger.debug(`[permission-gate] ALLOW "${operation}"`);
      return PermissionLevel.ALLOW;
    }
    if (WRITE_ASK_PATTERNS.some((p) => p.test(operation)) ||
        TERMINAL_ASK_PATTERNS.some((p) => p.test(operation))) {
      logger.debug(`[permission-gate] ASK   "${operation}"`);
      return PermissionLevel.ASK;
    }
    // Unknown — treat as write-level ASK (safe default)
    logger.debug(`[permission-gate] ASK   "${operation}" (default — unknown operation)`);
    return PermissionLevel.ASK;
  }

  /**
   * Gate an operation: returns `true` if allowed to proceed.
   *
   *  - DENY              → always returns false.
   *  - ALLOW             → always returns true.
   *  - WRITE_ASK + non-TTY → denied unless sessionTrust is set.
   *    File writes and git mutations must never be silently approved in CI.
   *  - TERMINAL_ASK + non-TTY → allowed (DENY_PATTERNS already block dangerous
   *    shell commands; safe commands like `pnpm test` should work in CI).
   *  - Any ASK + TTY     → prompts the user interactively.
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

    // Session trust grants all ASK operations for this session
    if (this.sessionTrust) {
      return true;
    }

    // Non-interactive mode (CI, pipes)
    if (!process.stdin.isTTY) {
      const isWrite = WRITE_ASK_PATTERNS.some((p) => p.test(operation));
      if (isWrite) {
        // Write/git mutations must never be auto-approved in non-TTY.
        // Silently writing files or committing in CI without explicit trust is a
        // data integrity risk — the user must pass --yes / call grantSessionTrust().
        logger.warn(
          `[permission-gate] DENIED in non-interactive mode: "${operation}". ` +
          `Pass --yes or call grantSessionTrust() to allow write operations in CI.`,
        );
        return false;
      }
      // Terminal execution: allowed in non-TTY — dangerous patterns are already
      // blocked by DENY_PATTERNS before we reach this point.
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

  /**
   * Show a diff preview before approving a write operation.
   *
   * Emits the diff to stdout (caller already rendered it via UIRenderer),
   * then asks [Y/n/e]:
   *   Y / Enter → proceed
   *   n         → cancel
   *   e         → open $EDITOR (falls back to proceed if no EDITOR set)
   *
   * In non-TTY mode: denied unless sessionTrust is set (same as write tools).
   */
  async requestApprovalWithDiff(
    operation: string,
    diffOutput: string,
    onEdit?: () => Promise<void>,
  ): Promise<boolean> {
    // Session trust bypasses the prompt
    if (this.sessionTrust) return true;

    // Non-TTY: never auto-approve write mutations
    if (!process.stdin.isTTY) {
      logger.warn(
        `[permission-gate] DENIED in non-interactive mode: "${operation}". ` +
        `Pass --yes or call grantSessionTrust() to allow write operations in CI.`,
      );
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
      });

      rl.question(
        `\n  [Koda] ${operation} — apply this change? [Y/n/e] `,
        async (answer) => {
          rl.close();
          const a = answer.trim().toLowerCase();
          if (a === 'e' || a === 'edit') {
            await onEdit?.();
            resolve(true);
          } else {
            const approved = a === '' || a === 'y' || a === 'yes';
            logger.debug(
              `[permission-gate] User ${approved ? 'approved' : 'denied'}: "${operation}"`,
            );
            resolve(approved);
          }
        },
      );
    });
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
