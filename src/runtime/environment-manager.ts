/**
 * EnvironmentManager — constructs a safe, minimal environment for sandboxed
 * command execution.
 *
 * The produced env object is passed to child_process.spawn so that:
 *   1. Secrets from the parent process are not leaked to arbitrary commands.
 *   2. Essential PATH entries required for build/test tooling are preserved.
 *   3. NODE_ENV is set to a predictable value.
 */
export class EnvironmentManager {
  /**
   * Build a filtered environment for a sandboxed command.
   *
   * @param rootPath - Repository root passed as cwd to the child process.
   * @param extra    - Any extra env vars the caller wants to inject.
   * @returns A plain object safe to pass as `env` to spawn().
   */
  static buildEnv(
    rootPath: string,
    extra: Record<string, string> = {},
  ): NodeJS.ProcessEnv {
    // Allowlist: keys from the parent process that are safe to forward
    const ALLOWLIST: string[] = [
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'SHELL',
      'TERM',
      'LANG',
      'LC_ALL',
      'LC_CTYPE',
      'TMPDIR',
      'TMP',
      'TEMP',
      // Node / package manager
      'NODE_PATH',
      'NPM_CONFIG_CACHE',
      'PNPM_HOME',
      // Git needs these to resolve author info
      'GIT_AUTHOR_NAME',
      'GIT_AUTHOR_EMAIL',
      'GIT_COMMITTER_NAME',
      'GIT_COMMITTER_EMAIL',
      // Editor / CI safe-passthrough
      'CI',
      'GITHUB_ACTIONS',
    ];

    const filtered: NodeJS.ProcessEnv = { NODE_ENV: 'development' };

    for (const key of ALLOWLIST) {
      if (process.env[key] !== undefined) {
        filtered[key] = process.env[key];
      }
    }

    // Always inject the repository root for convenience
    filtered['KODA_ROOT'] = rootPath;

    return { ...filtered, ...extra };
  }

  /**
   * Return true if a given environment key looks sensitive and should be
   * blocked from leaking to child processes.
   */
  static isSensitiveKey(key: string): boolean {
    const lk = key.toLowerCase();
    return (
      lk.includes('key')    ||
      lk.includes('secret') ||
      lk.includes('token')  ||
      lk.includes('password') ||
      lk.includes('pass')   ||
      lk.includes('auth')   ||
      lk.includes('credential')
    );
  }
}
