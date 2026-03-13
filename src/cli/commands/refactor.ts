import { Command } from 'commander';
import { buildCommand } from './build.js';

export const refactorCommand = new Command('refactor')
  .description('Refactor code using AI agents')
  .argument('<target>', 'Code or module to refactor')
  .option('--preview', 'Preview changes without executing')
  .option('--auto-commit', 'Automatically commit changes')
  .action(async (target: string, options: { preview?: boolean; autoCommit?: boolean }) => {
    // Reuse build command with refactor-specific context
    const refactorTask = `Refactor the following: ${target}`;
    await buildCommand.parseAsync(['node', 'koda', 'build', refactorTask, ...buildFlags(options)]);
  });

function buildFlags(options: { preview?: boolean; autoCommit?: boolean }): string[] {
  const flags: string[] = [];
  if (options.preview) flags.push('--preview');
  if (options.autoCommit) flags.push('--auto-commit');
  return flags;
}
