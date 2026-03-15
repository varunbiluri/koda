import { spawn }        from 'node:child_process';
import { EnvironmentManager } from './environment-manager.js';

export interface CommandResult {
  stdout:     string;
  stderr:     string;
  exitCode:   number;
  timedOut:   boolean;
  durationMs: number;
}

export interface CommandOptions {
  /**
   * Working directory for the command (must be inside the repository root).
   * Defaults to rootPath.
   */
  cwd?: string;
  /** Additional env vars to inject (merged on top of the allowlisted set). */
  env?: Record<string, string>;
  /** Timeout in milliseconds.  Defaults to 30 000 (30 s). */
  timeoutMs?: number;
  /** Optional callback for streaming stdout lines as they arrive. */
  onStdout?: (line: string) => void;
  /** Optional callback for streaming stderr lines as they arrive. */
  onStderr?: (line: string) => void;
  /** Optional AbortSignal to cancel the process externally. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES   = 1_024 * 1_024; // 1 MiB per stream

/**
 * CommandExecutor — spawns shell commands safely with:
 *   - Filtered environment (no secrets)
 *   - Hard timeout with SIGTERM + SIGKILL
 *   - Output size cap to prevent memory exhaustion
 *   - Optional stdout/stderr streaming callbacks
 *   - AbortSignal support
 */
export class CommandExecutor {
  constructor(private readonly rootPath: string) {}

  async run(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    const {
      cwd       = this.rootPath,
      env       = {},
      timeoutMs = DEFAULT_TIMEOUT_MS,
      onStdout,
      onStderr,
      signal,
    } = options;

    const t0 = Date.now();

    return new Promise<CommandResult>((resolve) => {
      const safeEnv = EnvironmentManager.buildEnv(this.rootPath, env);

      const child = spawn('sh', ['-c', command], {
        cwd,
        env:   safeEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdoutBuf = '';
      let stderrBuf = '';
      let timedOut  = false;
      let done      = false;

      const finish = (exitCode: number): void => {
        if (done) return;
        done = true;
        clearTimeout(hardKillTimer);
        clearTimeout(softKillTimer);
        resolve({
          stdout:     stdoutBuf,
          stderr:     stderrBuf,
          exitCode,
          timedOut,
          durationMs: Date.now() - t0,
        });
      };

      // ── Timeout: SIGTERM → SIGKILL after 2 s ───────────────────────────────
      const softKillTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      const hardKillTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, timeoutMs + 2_000);

      // ── AbortSignal ────────────────────────────────────────────────────────
      if (signal) {
        signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        }, { once: true });
      }

      // ── Stdout ─────────────────────────────────────────────────────────────
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stdoutBuf.length < MAX_OUTPUT_BYTES) {
          stdoutBuf += text;
        }
        if (onStdout) {
          text.split('\n').forEach((line) => { if (line) onStdout(line); });
        }
      });

      // ── Stderr ─────────────────────────────────────────────────────────────
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stderrBuf.length < MAX_OUTPUT_BYTES) {
          stderrBuf += text;
        }
        if (onStderr) {
          text.split('\n').forEach((line) => { if (line) onStderr(line); });
        }
      });

      child.on('close', (code) => finish(code ?? 1));
      child.on('error', ()     => finish(1));
    });
  }
}
