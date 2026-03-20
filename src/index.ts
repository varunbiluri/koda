// Fast exit for --version / -V before loading anything heavy
if (process.argv.includes('--version') || process.argv.includes('-V')) {
  const { VERSION } = await import('./constants.js');
  process.stdout.write(VERSION + '\n');
  process.exit(0);
}

if (process.argv.length <= 2) {
  const { SessionManager } = await import('./cli/session/session-manager.js');
  const session = new SessionManager();
  session.start(process.cwd()).catch((err: unknown) => {
    // Render a readable error and stay alive — the readline loop will
    // end naturally; no forced exit for recoverable start failures.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  Koda: session error — ${msg}`);
    console.error('  Run `koda doctor` to diagnose, or `koda login` to reconfigure.\n');
  });
} else {
  const { createProgram } = await import('./cli/index.js');
  const program = createProgram();
  program.parse(process.argv);
}
