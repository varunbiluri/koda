/**
 * optimize-file command for VS Code extension.
 * Runs Koda optimization agent on the active file and shows patch preview.
 */
export async function optimizeFile(
  uri: string,
  showDiff: (diff: string) => Promise<boolean>,
  applyPatch: (previewId: string) => Promise<void>,
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>,
): Promise<void> {
  try {
    const result = await executeCommand('koda.lsp.executeCommand', {
      command: 'koda/optimizeFile',
      arguments: [{ uri }],
    }) as { diff?: string; previewId?: string } | null;

    if (!result?.diff || !result?.previewId) {
      return;
    }

    const approved = await showDiff(result.diff);
    if (approved) {
      await applyPatch(result.previewId);
    }
  } catch (err) {
    console.error(`[Koda] Optimize error: ${(err as Error).message}`);
  }
}
