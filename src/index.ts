import { createProgram } from './cli/index.js';

const program = createProgram();

// If no args, start REPL; otherwise parse command
if (process.argv.length <= 2) {
  program.parse(['node', 'koda', 'repl']);
} else {
  program.parse(process.argv);
}
