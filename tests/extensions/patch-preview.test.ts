import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PatchPreview } from '../../src/preview/patch-preview.js';
import type { FilePatch } from '../../src/patch/types.js';

// Mock PatchApplier
vi.mock('../../src/patch/patch-applier.js', () => {
  class PatchApplier {
    applyPatch = vi.fn().mockResolvedValue({ success: true, filePath: 'src/foo.ts', applied: true });
    applyPatches = vi.fn().mockResolvedValue([{ success: true, filePath: 'src/foo.ts', applied: true }]);
    revertPatch = vi.fn().mockResolvedValue({ success: true, filePath: 'src/foo.ts', applied: false });
  }
  return { PatchApplier };
});

function makeFilePatch(filePath: string): FilePatch {
  return {
    filePath,
    oldContent: 'const x = 1;\n',
    newContent: 'const x = 2;\n',
    patch: `--- ${filePath}\n+++ ${filePath}\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;\n`,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ['-const x = 1;', '+const x = 2;'],
      },
    ],
  };
}

describe('PatchPreview', () => {
  let preview: PatchPreview;

  beforeEach(() => {
    preview = new PatchPreview();
  });

  it('createPreview returns a PreviewResult with metadata', () => {
    const patches = [makeFilePatch('src/foo.ts'), makeFilePatch('src/bar.ts')];
    const result = preview.createPreview(patches, '/project');

    expect(result.previewId).toBeTruthy();
    expect(result.patches).toHaveLength(2);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].filePath).toBe('src/foo.ts');
    expect(result.files[0].addedLines).toBe(1);
    expect(result.files[0].removedLines).toBe(1);
    expect(result.createdAt).toBeTruthy();
  });

  it('hasPending returns true after createPreview', () => {
    const patches = [makeFilePatch('src/foo.ts')];
    const result = preview.createPreview(patches, '/project');
    expect(preview.hasPending(result.previewId)).toBe(true);
  });

  it('approve calls PatchApplier with correct patches', async () => {
    const patches = [makeFilePatch('src/foo.ts')];
    const result = preview.createPreview(patches, '/project');

    const applyResults = await preview.approve(result.previewId);

    expect(applyResults).toHaveLength(1);
    expect(applyResults[0].success).toBe(true);
    expect(applyResults[0].filePath).toBe('src/foo.ts');
  });

  it('approve removes pending preview', async () => {
    const patches = [makeFilePatch('src/foo.ts')];
    const result = preview.createPreview(patches, '/project');
    await preview.approve(result.previewId);
    expect(preview.hasPending(result.previewId)).toBe(false);
  });

  it('reject removes pending preview without applying', async () => {
    const patches = [makeFilePatch('src/foo.ts')];
    const result = preview.createPreview(patches, '/project');
    await preview.reject(result.previewId);
    expect(preview.hasPending(result.previewId)).toBe(false);
  });

  it('approve throws for unknown previewId', async () => {
    await expect(preview.approve('nonexistent-id')).rejects.toThrow('No pending preview');
  });

  it('counts added and removed lines correctly', () => {
    const patch: FilePatch = {
      filePath: 'src/multi.ts',
      oldContent: 'a\nb\nc\n',
      newContent: 'x\ny\nz\nw\n',
      patch: '',
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 4,
          lines: ['-a', '-b', '-c', '+x', '+y', '+z', '+w'],
        },
      ],
    };

    const result = preview.createPreview([patch], '/project');
    expect(result.files[0].addedLines).toBe(4);
    expect(result.files[0].removedLines).toBe(3);
  });
});
