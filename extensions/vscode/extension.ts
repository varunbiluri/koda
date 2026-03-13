/**
 * Koda VS Code Extension entry point.
 *
 * Activates an LSP LanguageClient connecting to the `koda start-lsp` subprocess.
 * Registers 4 commands: koda.explainCode, koda.refactorCode, koda.generateTests, koda.optimizeFile.
 *
 * NOTE: This file uses VS Code API types via interfaces to avoid a hard dependency
 * on the vscode module at build time (it is injected at runtime by VS Code).
 */

interface ExtensionContext {
  subscriptions: Array<{ dispose(): void }>;
}

interface OutputChannel {
  appendLine(value: string): void;
  show(): void;
}

interface TextEditor {
  document: { uri: { toString(): string }; languageId: string };
  selection: { isEmpty: boolean };
  selections: Array<{ isEmpty: boolean }>;
}

// These are resolved at runtime inside activate()
let vscodeApi: typeof import('vscode') | undefined;

export function activate(context: ExtensionContext): void {
  // Dynamic require so the file compiles without the vscode peer dep
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  vscodeApi = require('vscode') as typeof import('vscode');
  const vscode = vscodeApi;

  const outputChannel: OutputChannel = vscode.window.createOutputChannel('Koda');

  // Start LSP client connecting to `koda start-lsp`
  const { LanguageClient, TransportKind } = require('vscode-languageclient/node') as typeof import('vscode-languageclient/node');

  const client = new LanguageClient(
    'kodaLsp',
    'Koda Language Server',
    {
      command: 'node',
      args: [require.resolve('../../dist/index.js'), 'start-lsp'],
      transport: TransportKind.stdio,
    },
    {
      documentSelector: [
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'python' },
      ],
    },
  );

  client.start();
  context.subscriptions.push({ dispose: () => void client.stop() });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('koda.explainCode', async () => {
      const editor = vscode.window.activeTextEditor as TextEditor | undefined;
      if (!editor) return;
      const sel = (editor as unknown as import('vscode').TextEditor).selection;
      const text = (editor as unknown as import('vscode').TextEditor).document.getText(sel);
      const uri = editor.document.uri.toString();

      outputChannel.appendLine(`[Koda] Explaining code from: ${uri}`);
      outputChannel.show();

      const result = await client.sendRequest('workspace/executeCommand', {
        command: 'koda/explainCode',
        arguments: [{ uri, text }],
      });

      if (result && typeof result === 'object' && 'explanation' in result) {
        outputChannel.appendLine(String((result as { explanation: string }).explanation));
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('koda.refactorCode', async () => {
      const editor = vscode.window.activeTextEditor as unknown as import('vscode').TextEditor | undefined;
      if (!editor) return;
      const sel = editor.selection;
      const text = editor.document.getText(sel);
      const uri = editor.document.uri.toString();

      const result = await client.sendRequest('workspace/executeCommand', {
        command: 'koda/refactorCode',
        arguments: [{ uri, text, range: sel }],
      }) as { diff?: string; newText?: string } | null;

      if (result?.diff) {
        const choice = await vscode.window.showInformationMessage(
          'Koda proposes a refactoring. Apply?',
          'Apply',
          'Cancel',
        );
        if (choice === 'Apply' && result.newText) {
          const wsEdit = new vscode.WorkspaceEdit();
          wsEdit.replace(editor.document.uri, sel, result.newText);
          await vscode.workspace.applyEdit(wsEdit);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('koda.generateTests', async () => {
      const editor = vscode.window.activeTextEditor as unknown as import('vscode').TextEditor | undefined;
      if (!editor) return;
      const sel = editor.selection;
      const text = editor.document.getText(sel);
      const uri = editor.document.uri.toString();

      const result = await client.sendRequest('workspace/executeCommand', {
        command: 'koda/generateTests',
        arguments: [{ uri, text }],
      }) as { testCode?: string } | null;

      if (result?.testCode) {
        const doc = await vscode.workspace.openTextDocument({
          content: result.testCode,
          language: 'typescript',
        });
        await vscode.window.showTextDocument(doc);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('koda.optimizeFile', async () => {
      const editor = vscode.window.activeTextEditor as unknown as import('vscode').TextEditor | undefined;
      if (!editor) return;
      const uri = editor.document.uri.toString();

      const result = await client.sendRequest('workspace/executeCommand', {
        command: 'koda/optimizeFile',
        arguments: [{ uri }],
      }) as { diff?: string; previewId?: string } | null;

      if (result?.diff) {
        const choice = await vscode.window.showInformationMessage(
          'Koda found optimizations. Apply?',
          'Apply',
          'Cancel',
        );
        if (choice === 'Apply' && result.previewId) {
          await client.sendRequest('workspace/executeCommand', {
            command: 'koda/applyPatch',
            arguments: [{ previewId: result.previewId }],
          });
        }
      }
    }),
  );
}

export function deactivate(): void {
  vscodeApi = undefined;
}
