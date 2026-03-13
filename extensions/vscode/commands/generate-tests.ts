/**
 * generate-tests command for VS Code extension.
 * Generates test file for the selected function/file via Koda.
 */
export async function generateTests(
  uri: string,
  selectedText: string,
  showPreview: (content: string, language: string) => Promise<void>,
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>,
): Promise<void> {
  if (!selectedText.trim()) {
    return;
  }

  try {
    const result = await executeCommand('koda.lsp.executeCommand', {
      command: 'koda/generateTests',
      arguments: [{ uri, text: selectedText }],
    }) as { testCode?: string; testFilePath?: string } | null;

    if (!result?.testCode) {
      return;
    }

    await showPreview(result.testCode, 'typescript');
  } catch (err) {
    console.error(`[Koda] Generate tests error: ${(err as Error).message}`);
  }
}
