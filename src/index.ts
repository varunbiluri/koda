import { logger } from './utils/logger.js';

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION', err);
});

process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED PROMISE', err);
});

/**
 * Dispatches the CLI startup flow based on command-line arguments.
 *
 * If `--version` or `-V` is present, writes the package version to stdout and exits early.
 * If no additional arguments are provided, starts an interactive session in the current working directory.
 * Otherwise, constructs and runs the CLI command parser with the provided arguments.
 */
async function run(): Promise<void> {
  // Fast exit for --version / -V before loading anything heavy
  if (process.argv.includes('--version') || process.argv.includes('-V')) {
    const { VERSION } = await import('./constants.js');
    process.stdout.write(VERSION + '\n');
    return;
  }

  if (process.argv.length <= 2) {
    const { SessionManager } = await import('./cli/session/session-manager.js');
    const session = new SessionManager();
    await session.start(process.cwd());
  } else {
    const { createProgram } = await import('./cli/index.js');
    const program = createProgram();
    program.parse(process.argv);
  }
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error('UNHANDLED ERROR', msg);
  console.error(`\n  Koda: ${msg}`);
  console.error('  Run `koda doctor` to diagnose, or `/login` in session to reconfigure.\n');
});
