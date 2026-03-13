import { createProgram } from './cli/index.js';
import { SessionManager } from './cli/session/session-manager.js';

// If no subcommand given, start the conversational session
if (process.argv.length <= 2) {
  const session = new SessionManager();
  session.start(process.cwd()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  const program = createProgram();
  program.parse(process.argv);
}
