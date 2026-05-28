import * as vscode from 'vscode';
import { ChatViewProvider } from './webview/chatViewProvider';
import { probeScodeAvailability } from './acp/env';

const SCODE_INSTALL_URL = 'https://sudocode.dev/install';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider),
    vscode.commands.registerCommand('sudocode.restart', () => provider.restart()),
    vscode.commands.registerCommand('sudocode.sendSelection', () => sendContext(provider, true)),
    vscode.commands.registerCommand('sudocode.sendFile', () => sendContext(provider, false)),
  );

  void warnIfScodeMissing();
}

async function warnIfScodeMissing(): Promise<void> {
  const configured = vscode.workspace.getConfiguration('sudocode').get<string>('cliPath') || undefined;
  const problem = probeScodeAvailability(configured);
  if (!problem) return;
  const choice = await vscode.window.showWarningMessage(
    `Sudocode: ${problem}`,
    'Open Install Guide',
    'Set CLI Path…',
  );
  if (choice === 'Open Install Guide') {
    void vscode.env.openExternal(vscode.Uri.parse(SCODE_INSTALL_URL));
  } else if (choice === 'Set CLI Path…') {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'sudocode.cliPath');
  }
}

export function deactivate(): void {
  // Sessions are disposed via the webview's onDidDispose.
}

async function sendContext(provider: ChatViewProvider, useSelection: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Sudocode: no active editor.');
    return;
  }
  const snippet = buildContextSnippet(editor, useSelection);
  await vscode.commands.executeCommand('sudocode.chatView.focus');
  provider.prefill(snippet);
}

function buildContextSnippet(editor: vscode.TextEditor, useSelection: boolean): string {
  const doc = editor.document;
  const relPath = vscode.workspace.asRelativePath(doc.uri, false);
  const lang = doc.languageId || '';
  const selection = editor.selection;
  let text: string;
  let header: string;
  if (useSelection && !selection.isEmpty) {
    text = doc.getText(selection);
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;
    header = startLine === endLine ? `${relPath}:${startLine}` : `${relPath}:${startLine}-${endLine}`;
  } else {
    text = doc.getText();
    header = relPath;
  }
  return `\`${header}\`\n\`\`\`${lang}\n${text}\n\`\`\``;
}
