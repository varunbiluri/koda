import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiffRenderer } from '../../src/preview/diff-renderer.js';
import { PatchPreview } from '../../src/preview/patch-preview.js';
import type { FilePatch } from '../../src/patch/types.js';

// Mock prompts for interactive approve tests
vi.mock('prompts', () => {
  const fn = vi.fn();
  (fn as unknown as { override: ReturnType<typeof vi.fn> }).override = vi.fn();
  return { default: fn };
});

// Mock PatchApplier so we never touch the filesystem
vi.mock('../../src/patch/patch-applier.js', () => {
  class PatchApplier {
    applyPatches = vi.fn().mockResolvedValue([{ success: true }]);
  }
  return { PatchApplier };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePatch(filePath = 'src/auth.ts'): FilePatch {
  return {
    filePath,
    oldContent: 'const x = 1;\n',
    newContent: 'const x = 2;\n',
    patch: '',
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

// ── DiffRenderer ──────────────────────────────────────────────────────────────

describe('DiffRenderer.renderToTerminal', () => {
  const renderer = new DiffRenderer();

  it('includes the file path in output', () => {
    const out = renderer.renderToTerminal(makePatch('src/auth.ts'));
    expect(out).toContain('src/auth.ts');
  });

  it('contains the hunk header', () => {
    const out = renderer.renderToTerminal(makePatch());
    expect(out).toContain('@@ -1,1 +1,1 @@');
  });

  it('addition lines are present in output', () => {
    const out = renderer.renderToTerminal(makePatch());
    expect(out).toContain('+const x = 2;');
  });

  it('deletion lines are present in output', () => {
    const out = renderer.renderToTerminal(makePatch());
    expect(out).toContain('-const x = 1;');
  });
});

describe('DiffRenderer.renderToMarkdown', () => {
  const renderer = new DiffRenderer();

  it('wraps output in a diff code block', () => {
    const out = renderer.renderToMarkdown(makePatch());
    expect(out).toMatch(/^```diff/);
    expect(out).toMatch(/```$/);
  });

  it('includes addition and deletion lines', () => {
    const out = renderer.renderToMarkdown(makePatch());
    expect(out).toContain('+const x = 2;');
    expect(out).toContain('-const x = 1;');
  });
});

// ── PatchPreview.interactiveApprove ───────────────────────────────────────────

describe('PatchPreview.interactiveApprove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies patch and returns results when user selects Yes', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts.mockResolvedValueOnce({ choice: 'yes' });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    const preview = new PatchPreview();
    const result = preview.createPreview([makePatch()], '/project');

    const patchResults = await preview.interactiveApprove(result.previewId);
    expect(patchResults).not.toBeNull();
    expect(patchResults).toHaveLength(1);
  });

  it('rejects patch and returns null when user selects No', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts.mockResolvedValueOnce({ choice: 'no' });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    const preview = new PatchPreview();
    const result = preview.createPreview([makePatch()], '/project');
    const id = result.previewId;

    const patchResults = await preview.interactiveApprove(id);
    expect(patchResults).toBeNull();
    expect(preview.hasPending(id)).toBe(false);
  });

  it('rejects patch when prompt is cancelled', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts.mockResolvedValueOnce({ choice: undefined });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    const preview = new PatchPreview();
    const result = preview.createPreview([makePatch()], '/project');

    const patchResults = await preview.interactiveApprove(result.previewId);
    expect(patchResults).toBeNull();
  });

  it('throws when previewId does not exist', async () => {
    const preview = new PatchPreview();
    await expect(preview.interactiveApprove('nonexistent')).rejects.toThrow('No pending preview');
  });

  it('renders diff for each patch before prompting', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts.mockResolvedValueOnce({ choice: 'no' });

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    const preview = new PatchPreview();
    const result = preview.createPreview([makePatch('src/auth.ts')], '/project');
    await preview.interactiveApprove(result.previewId);

    expect(logs.some((l) => l.includes('src/auth.ts'))).toBe(true);
  });

  it('shows Proposed changes header before diff', async () => {
    const prompts = (await import('prompts')).default as ReturnType<typeof vi.fn>;
    prompts.mockResolvedValueOnce({ choice: 'no' });

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    const preview = new PatchPreview();
    const result = preview.createPreview([makePatch()], '/project');
    await preview.interactiveApprove(result.previewId);

    expect(logs.some((l) => l.includes('Proposed changes'))).toBe(true);
  });
});

// ── UIRenderer.stream ─────────────────────────────────────────────────────────

describe('UIRenderer.stream', () => {
  it('writes the message to stdout', async () => {
    const { UIRenderer } = await import('../../src/cli/session/ui-renderer.js');
    const renderer = new UIRenderer();

    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
      written.push(String(data));
      return true;
    });

    renderer.stream('🔍  reading files');
    expect(written.some((s) => s.includes('reading files'))).toBe(true);
  });

  it('prefixes the message with two spaces for alignment', async () => {
    const { UIRenderer } = await import('../../src/cli/session/ui-renderer.js');
    const renderer = new UIRenderer();

    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
      written.push(String(data));
      return true;
    });

    renderer.stream('🧠  planning changes');
    expect(written.some((s) => s.startsWith('  '))).toBe(true);
  });
});

// ── ReasoningEngine onStage callback ─────────────────────────────────────────

describe('ReasoningEngine.analyzeStream — onStage', () => {
  it('emits stage messages during reasoning pipeline', async () => {
    // Mock all heavy dependencies
    vi.doMock('../../src/search/query-engine.js', () => ({
      QueryEngine: class {
        search = vi.fn().mockReturnValue([{ chunkId: 'c1', score: 0.9 }]);
      },
    }));

    vi.doMock('../../src/context/context-builder.js', () => ({
      buildContext: vi.fn().mockReturnValue({
        context: 'code context',
        chunks: [{ id: 'c1', filePath: 'src/auth.ts', content: 'code' }],
        estimatedTokens: 100,
        truncated: false,
      }),
      formatFileReferences: vi.fn().mockReturnValue([]),
    }));

    vi.doMock('../../src/ai/prompts/system-prompt.js', () => ({
      getSystemPrompt: vi.fn().mockReturnValue('system'),
    }));

    vi.doMock('../../src/ai/prompts/code-analysis.js', () => ({
      buildCodeAnalysisPrompt: vi.fn().mockReturnValue('user prompt'),
    }));

    const mockProvider = {
      streamChatCompletion: vi.fn().mockImplementation(
        async (_req: unknown, onChunk: (s: string) => void) => {
          onChunk('response chunk');
        },
      ),
      sendChatCompletion: vi.fn(),
      listModels: vi.fn(),
    };

    const mockIndex = {
      chunks: [{ id: 'c1', filePath: 'src/auth.ts', content: 'code' }],
      metadata: { version: '1', createdAt: '', rootPath: '/p', fileCount: 1, chunkCount: 1, edgeCount: 0 },
      files: [],
      edges: [],
      nodes: [],
      vectors: [],
      vocabulary: { terms: [], termToIndex: {} },
    };

    const { ReasoningEngine } = await import('../../src/ai/reasoning/reasoning-engine.js');
    const engine = new ReasoningEngine(mockIndex as never, mockProvider);

    const stages: string[] = [];
    await engine.analyzeStream('explain auth', () => {}, {}, (msg) => stages.push(msg));

    expect(stages).toContain('🔍  reading files');
    expect(stages).toContain('🧠  planning changes');
    expect(stages).toContain('✏  generating response');
  });
});
