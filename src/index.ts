// Fast exit for --version / -V before loading anything heavy
if (process.argv.includes('--version') || process.argv.includes('-V')) {
  const { VERSION } = await import('./constants.js');
  process.stdout.write(VERSION + '\n');
  process.exit(0);
}

if (process.argv.length <= 2) {
  const { SessionManager } = await import('./cli/session/session-manager.js');
  const session = new SessionManager();
  session.start(process.cwd()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  const { createProgram } = await import('./cli/index.js');
  const program = createProgram();
  program.parse(process.argv);
}
