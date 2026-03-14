import { randomUUID } from 'crypto';
import chalk from 'chalk';
import prompts from 'prompts';
import { PatchApplier } from '../patch/patch-applier.js';
import { DiffRenderer } from './diff-renderer.js';
import type { FilePatch, PatchResult } from '../patch/types.js';

export interface PreviewFileMeta {
  filePath: string;
  hunksCount: number;
  addedLines: number;
  removedLines: number;
}

export interface PreviewResult {
  previewId: string;
  patches: FilePatch[];
  files: PreviewFileMeta[];
  createdAt: string;
}

const pending = new Map<string, { patches: FilePatch[]; rootPath: string }>();

/**
 * PatchPreview - Manages patch previews with approve/reject workflow.
 */
export class PatchPreview {
  private applier = new PatchApplier();

  createPreview(patches: FilePatch[], rootPath: string): PreviewResult {
    const previewId = randomUUID();
    pending.set(previewId, { patches, rootPath });

    const files: PreviewFileMeta[] = patches.map((p) => {
      let added = 0;
      let removed = 0;
      for (const hunk of p.hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith('+')) added++;
          else if (line.startsWith('-')) removed++;
        }
      }
      return {
        filePath: p.filePath,
        hunksCount: p.hunks.length,
        addedLines: added,
        removedLines: removed,
      };
    });

    return {
      previewId,
      patches,
      files,
      createdAt: new Date().toISOString(),
    };
  }

  async approve(previewId: string): Promise<PatchResult[]> {
    const entry = pending.get(previewId);
    if (!entry) throw new Error(`No pending preview with id: ${previewId}`);
    pending.delete(previewId);
    return this.applier.applyPatches(entry.patches, entry.rootPath);
  }

  async reject(previewId: string): Promise<void> {
    pending.delete(previewId);
  }

  hasPending(previewId: string): boolean {
    return pending.has(previewId);
  }

  /**
   * Show a colored diff of all patches, then prompt the user to apply or discard.
   * Returns the PatchResult array on approval, or null if the user declines.
   */
  async interactiveApprove(previewId: string): Promise<PatchResult[] | null> {
    const entry = pending.get(previewId);
    if (!entry) throw new Error(`No pending preview with id: ${previewId}`);

    const renderer = new DiffRenderer();

    console.log();
    console.log('  ' + chalk.bold('Proposed changes:'));
    console.log();

    for (const patch of entry.patches) {
      console.log(renderer.renderToTerminal(patch));
      console.log();
    }

    const { choice } = await prompts({
      type: 'select',
      name: 'choice',
      message: 'Apply patch?',
      choices: [
        { title: 'Yes', value: 'yes' },
        { title: 'No', value: 'no' },
      ],
    });

    if (!choice || choice === 'no') {
      await this.reject(previewId);
      return null;
    }

    return this.approve(previewId);
  }
}
