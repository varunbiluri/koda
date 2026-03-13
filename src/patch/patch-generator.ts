import type { FilePatch, PatchHunk } from './types.js';

export class PatchGenerator {
  generatePatch(filePath: string, oldContent: string, newContent: string): FilePatch {
    const patches = this.createUnifiedDiff(filePath, oldContent, newContent);
    const hunks = this.parseHunks(patches);

    return {
      filePath,
      oldContent,
      newContent,
      patch: patches,
      hunks,
    };
  }

  private createUnifiedDiff(filePath: string, oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let patch = `--- ${filePath}\n+++ ${filePath}\n`;

    // Simple line-by-line diff
    const maxLen = Math.max(oldLines.length, newLines.length);
    let hunkStart = 0;
    let hunkLines: string[] = [];

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i] || '';
      const newLine = newLines[i] || '';

      if (oldLine !== newLine) {
        if (hunkLines.length === 0) {
          hunkStart = i;
        }
        if (oldLine && !newLine) {
          hunkLines.push(`-${oldLine}`);
        } else if (!oldLine && newLine) {
          hunkLines.push(`+${newLine}`);
        } else {
          hunkLines.push(`-${oldLine}`);
          hunkLines.push(`+${newLine}`);
        }
      } else if (hunkLines.length > 0) {
        // End of hunk
        patch += `@@ -${hunkStart + 1},${hunkLines.length} +${hunkStart + 1},${hunkLines.length} @@\n`;
        patch += hunkLines.join('\n') + '\n';
        hunkLines = [];
      }
    }

    // Final hunk
    if (hunkLines.length > 0) {
      patch += `@@ -${hunkStart + 1},${hunkLines.length} +${hunkStart + 1},${hunkLines.length} @@\n`;
      patch += hunkLines.join('\n') + '\n';
    }

    return patch;
  }

  private parseHunks(patch: string): PatchHunk[] {
    const hunks: PatchHunk[] = [];
    const lines = patch.split('\n');

    let currentHunk: PatchHunk | null = null;

    for (const line of lines) {
      // Parse hunk header: @@ -oldStart,oldLines +newStart,newLines @@
      const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);

      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }

        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldLines: parseInt(hunkMatch[2] || '1', 10),
          newStart: parseInt(hunkMatch[3], 10),
          newLines: parseInt(hunkMatch[4] || '1', 10),
          lines: [],
        };
      } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        currentHunk.lines.push(line);
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  formatPatchPreview(patch: FilePatch, maxLines: number = 50): string {
    const lines = patch.patch.split('\n');
    const preview = lines.slice(0, maxLines).join('\n');

    if (lines.length > maxLines) {
      return preview + `\n... (${lines.length - maxLines} more lines)`;
    }

    return preview;
  }
}
