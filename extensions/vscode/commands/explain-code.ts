/**
 * explain-code command for VS Code extension.
 * Gets selected text and sends it to Koda for explanation via LSP.
 */
export async function explainCode(
  uri: string,
  selectedText: string,
  outputChannel: { appendLine: (msg: string) => void; show: () => void },
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>,
): Promise<void> {
  if (!selectedText.trim()) {
    outputChannel.appendLine('[Koda] No code selected. Please select code to explain.');
    outputChannel.show();
    return;
  }

  outputChannel.appendLine(`[Koda] Explaining code from: ${uri}`);
  outputChannel.appendLine('---');
  outputChannel.show();

  try {
    const result = await executeCommand('koda.lsp.executeCommand', {
      command: 'koda/explainCode',
      arguments: [{ uri, text: selectedText }],
    });

    if (result && typeof result === 'object' && 'explanation' in result) {
      outputChannel.appendLine(String((result as { explanation: string }).explanation));
    } else {
      outputChannel.appendLine('[Koda] Explanation not available. Ensure .koda index is built.');
    }
  } catch (err) {
    outputChannel.appendLine(`[Koda] Error: ${(err as Error).message}`);
  }
}
