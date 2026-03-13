/**
 * refactor-code command for VS Code extension.
 * Sends selected code to Koda refactor agent and shows patch preview.
 */
export async function refactorCode(
  uri: string,
  selectedText: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  showDiff: (diff: string) => Promise<boolean>,
  applyEdit: (uri: string, range: typeof range, newText: string) => Promise<void>,
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>,
): Promise<void> {
  if (!selectedText.trim()) {
    return;
  }

  try {
    const result = await executeCommand('koda.lsp.executeCommand', {
      command: 'koda/refactorCode',
      arguments: [{ uri, text: selectedText, range }],
    }) as { diff?: string; newText?: string; previewId?: string } | null;

    if (!result?.diff || !result?.newText) {
      return;
    }

    const approved = await showDiff(result.diff);
    if (approved) {
      await applyEdit(uri, range, result.newText);
    }
  } catch (err) {
    console.error(`[Koda] Refactor error: ${(err as Error).message}`);
  }
}
