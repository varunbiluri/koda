import chalk from 'chalk';
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
