import { Command } from 'commander';
import { buildCommand } from './build.js';

export const fixCommand = new Command('fix')
  .description('Fix bugs or issues in the codebase using AI agents')
  .argument('<issue>', 'Issue or bug to fix')
  .option('--preview', 'Preview changes without executing')
  .option('--auto-commit', 'Automatically commit changes')
  .action(async (issue: string, options: { preview?: boolean; autoCommit?: boolean }) => {
    // Reuse build command with fix-specific context
    const fixTask = `Fix the following issue: ${issue}`;
    await buildCommand.parseAsync(['node', 'koda', 'build', fixTask, ...buildFlags(options)]);
  });

function buildFlags(options: { preview?: boolean; autoCommit?: boolean }): string[] {
  const flags: string[] = [];
  if (options.preview) flags.push('--preview');
  if (options.autoCommit) flags.push('--auto-commit');
  return flags;
}
