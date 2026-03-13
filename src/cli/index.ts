import { Command } from 'commander';
import { VERSION } from '../constants.js';
import { initCommand } from './commands/init.js';
import { askCommand } from './commands/ask.js';
import { statusCommand } from './commands/status.js';
import { replCommand } from './commands/repl.js';
import { loginCommand } from './commands/login.js';
import { modelsCommand } from './commands/models.js';
import { useCommand } from './commands/use.js';
import { buildCommand } from './commands/build.js';
import { fixCommand } from './commands/fix.js';
import { refactorCommand } from './commands/refactor.js';
import { createDoctorCommand } from './commands/doctor.js';
import { createHistoryCommand } from './commands/history.js';
import { createReplayCommand } from './commands/replay.js';

export function createProgram(): Command {
  const program = new Command('koda')
    .version(VERSION)
    .description('Koda — AI software engineer for your codebase');

  // Phase 1: Indexing
  program.addCommand(initCommand);
  program.addCommand(statusCommand);

  // Phase 2: AI Analysis
  program.addCommand(askCommand);
  program.addCommand(loginCommand);
  program.addCommand(modelsCommand);
  program.addCommand(useCommand);

  // Phase 3: Multi-Agent Execution
  program.addCommand(buildCommand);
  program.addCommand(fixCommand);
  program.addCommand(refactorCommand);

  // Phase 4: Self-Improvement & Observability
  program.addCommand(createDoctorCommand());
  program.addCommand(createHistoryCommand());
  program.addCommand(createReplayCommand());

  // Interactive mode
  program.addCommand(replCommand);

  return program;
}
