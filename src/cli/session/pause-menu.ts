/**
 * Ctrl+C pause menu — parse user choice reliably.
 */

import chalk from 'chalk';
import type * as readline from 'node:readline';

/** @internal exported for tests */
export function normalizePauseChoice(raw: string): 'resume' | 'cancel' | 'modify' {
  const t = raw.trim().toLowerCase();
  if (
    t === '2' || t === '[2]' ||
    t === 'cancel' || t === 'c' ||
    t === 'stop' || t === 'abort' ||
    t === 'exit' || t === 'quit' || t === 'q'
  ) {
    return 'cancel';
  }
  if (t === '3' || t === '[3]' || t === 'modify' || t === 'm') {
    return 'modify';
  }
  return 'resume';
}

type ReadlineExt = readline.Interface & { line?: string; cursor?: number };

/** Drop partial user input so pause choice is not merged with an old prompt line. */
export function clearReadlineInput(rl: readline.Interface): void {
  const ext = rl as ReadlineExt;
  const len = ext.line?.length ?? 0;
  if (len > 0) {
    rl.write(null, { ctrl: true, name: 'u' });
  }
  ext.line = '';
  ext.cursor = 0;
}

export function renderPauseMenu(): void {
  process.stdout.write('\n\n');
  console.log(`  ${chalk.bold('Task paused')}  ${chalk.gray('(task is still running)')}`);
  console.log();
  console.log(`  ${chalk.cyan('[1]')} ${chalk.white('Resume')}      continue the current task`);
  console.log(`  ${chalk.cyan('[2]')} ${chalk.white('Cancel')}      stop the task`);
  console.log(`  ${chalk.cyan('[3]')} ${chalk.white('Modify')}      cancel and enter a revised instruction`);
  console.log(`  ${chalk.gray('  Ctrl+C twice to cancel immediately · exit = cancel')}`);
}
