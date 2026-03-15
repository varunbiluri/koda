import chalk from 'chalk';
import * as readline from 'node:readline';
import type { FilePatch } from '../patch/types.js';

/**
 * DiffRenderer - Converts FilePatch diffs to styled output.
 */
export class DiffRenderer {
  renderToTerminal(patch: FilePatch): string {
    const lines: string[] = [];
    lines.push(chalk.bold(`--- ${patch.filePath}`));
    lines.push(chalk.bold(`+++ ${patch.filePath}`));

    for (const hunk of patch.hunks) {
      const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
      lines.push(chalk.cyan(header));

      for (const line of hunk.lines) {
        if (line.startsWith('+')) {
          lines.push(chalk.green(line));
        } else if (line.startsWith('-')) {
          lines.push(chalk.red(line));
        } else {
          lines.push(line);
        }
      }
    }

    return lines.join('\n');
  }

  renderToMarkdown(patch: FilePatch): string {
    const lines: string[] = [];
    lines.push('```diff');
    lines.push(`--- ${patch.filePath}`);
    lines.push(`+++ ${patch.filePath}`);

    for (const hunk of patch.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
      for (const line of hunk.lines) {
        lines.push(line);
      }
    }

    lines.push('```');
    return lines.join('\n');
  }
}

// ── Text diff generation ──────────────────────────────────────────────────────

export interface TextDiffLine {
  type:    'added' | 'removed' | 'context';
  content: string;
  lineNum: number;
}

/**
 * Generate a simple unified text diff between two strings.
 *
 * Uses a line-by-line comparison with 3-line context around changes.
 * Not a full Myers diff implementation — sufficient for displaying what
 * changed for user confirmation before applying edits.
 */
export function generateTextDiff(before: string, after: string, filePath: string): string {
  const beforeLines = before.split('\n');
  const afterLines  = after.split('\n');

  if (before === after) return '';

  const CONTEXT = 3;
  const output: string[] = [
    chalk.bold(`--- ${filePath}`),
    chalk.bold(`+++ ${filePath}`),
  ];

  // Simple two-pointer diff: find first and last differing line
  let firstDiff = 0;
  while (
    firstDiff < beforeLines.length &&
    firstDiff < afterLines.length &&
    beforeLines[firstDiff] === afterLines[firstDiff]
  ) {
    firstDiff++;
  }

  let lastBefore = beforeLines.length - 1;
  let lastAfter  = afterLines.length - 1;
  while (
    lastBefore > firstDiff &&
    lastAfter  > firstDiff &&
    beforeLines[lastBefore] === afterLines[lastAfter]
  ) {
    lastBefore--;
    lastAfter--;
  }

  const ctxStart = Math.max(0, firstDiff - CONTEXT);
  const ctxEndB  = Math.min(beforeLines.length - 1, lastBefore + CONTEXT);
  const ctxEndA  = Math.min(afterLines.length - 1, lastAfter + CONTEXT);

  const removedCount = lastBefore - firstDiff + 1;
  const addedCount   = lastAfter  - firstDiff + 1;

  output.push(
    chalk.cyan(
      `@@ -${ctxStart + 1},${ctxEndB - ctxStart + 1} +${ctxStart + 1},${ctxEndA - ctxStart + 1} @@`,
    ),
  );

  // Context lines before the change
  for (let i = ctxStart; i < firstDiff; i++) {
    output.push(`  ${beforeLines[i]}`);
  }

  // Removed lines
  for (let i = firstDiff; i <= lastBefore && i < beforeLines.length; i++) {
    output.push(chalk.red(`- ${beforeLines[i]}`));
  }

  // Added lines
  for (let i = firstDiff; i <= lastAfter && i < afterLines.length; i++) {
    output.push(chalk.green(`+ ${afterLines[i]}`));
  }

  // Context lines after the change
  const afterCtxStart = Math.max(firstDiff, lastBefore + 1);
  for (let i = afterCtxStart; i <= ctxEndB && i < beforeLines.length; i++) {
    output.push(`  ${beforeLines[i]}`);
  }

  // Summary line
  output.push('');
  output.push(
    chalk.gray(
      `  ${removedCount} line(s) removed, ${addedCount} line(s) added`,
    ),
  );

  return output.join('\n');
}

// ── Interactive confirmation ───────────────────────────────────────────────────

/**
 * Display a diff summary and prompt the user for confirmation.
 *
 * Returns `true` if the user accepts (y/Y/Enter) or if stdin is not a TTY
 * (non-interactive mode — always proceed).
 *
 * @param diffs - Map of filePath → { before, after } content snapshots.
 */
export async function promptDiffConfirmation(
  diffs:   Map<string, { before: string; after: string }>,
  label?:  string,
): Promise<boolean> {
  // In non-interactive mode (CI, pipes, test runners), always proceed
  if (!process.stdin.isTTY) return true;

  if (diffs.size === 0) return true;

  console.log();
  console.log('  ' + chalk.bold('Pending changes:'));
  console.log();

  for (const [filePath, { before, after }] of diffs) {
    const diff = generateTextDiff(before, after, filePath);
    if (diff) {
      // Indent each line for visual separation
      diff.split('\n').forEach((l) => console.log(`  ${l}`));
      console.log();
    }
  }

  if (label) {
    console.log(`  ${chalk.gray(label)}`);
  }

  return new Promise<boolean>((resolve) => {
    const rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
    });

    rl.question(
      chalk.cyan('  Apply these changes? ') + chalk.gray('[Y/n] ') ,
      (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
      },
    );
  });
}
