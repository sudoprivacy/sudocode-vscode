import * as vscode from 'vscode';
import type { Client } from '@agentclientprotocol/sdk';
import * as schema from '@agentclientprotocol/sdk';
import { TerminalManager } from './terminalManager';

export interface ClientHost {
  /** Forward streaming session updates to the UI. */
  onSessionUpdate(params: schema.SessionNotification): void;
  /** Ask the user to approve/reject a tool invocation. Resolve with chosen optionId, or null to cancel. */
  onRequestPermission(req: {
    toolTitle: string;
    toolKind?: string;
    options: Array<{ optionId: string; name: string; kind?: string }>;
  }): Promise<{ optionId: string | null }>;
}

interface ScodeQuestion {
  id: string;
  prompt: string;
  kind?: 'single_select' | 'multi_select' | 'text' | 'boolean';
  required?: boolean;
  allowCustomInput?: boolean;
  customInputHint?: string;
  options?: Array<{ label: string; value: string; description?: string; recommended?: boolean }>;
}

/**
 * Editor-side ACP Client. The agent (scode) calls back into these methods; the
 * SDK routes incoming requests here and serializes our return values as JSON-RPC
 * responses. Every method MUST resolve (or the agent's await hangs).
 */
export class SudocodeClient implements Client {
  private readonly terminals = new TerminalManager();

  constructor(private readonly host: ClientHost) {}

  dispose(): void {
    this.terminals.disposeAll();
  }

  async sessionUpdate(params: schema.SessionNotification): Promise<void> {
    this.host.onSessionUpdate(params);
  }

  async requestPermission(params: schema.RequestPermissionRequest): Promise<schema.RequestPermissionResponse> {
    const toolTitle = params.toolCall?.title ?? 'Sudocode wants to run a tool';
    const toolKind = params.toolCall?.kind ?? undefined;
    const options = params.options.map((opt) => ({
      optionId: opt.optionId,
      name: opt.name,
      kind: opt.kind,
    }));
    const { optionId } = await this.host.onRequestPermission({ toolTitle, toolKind: toolKind ?? undefined, options });
    if (!optionId) return { outcome: { outcome: 'cancelled' } };
    return { outcome: { outcome: 'selected', optionId } };
  }

  async readTextFile(params: schema.ReadTextFileRequest): Promise<schema.ReadTextFileResponse> {
    const uri = vscode.Uri.file(params.path);
    const opened = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
    let text: string;
    if (opened) {
      // Prefer in-memory contents so the agent sees the user's unsaved edits.
      text = opened.getText();
    } else {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = Buffer.from(bytes).toString('utf-8');
    }
    const startLine = params.line && params.line > 0 ? params.line - 1 : 0;
    const limit = params.limit ?? undefined;
    if (startLine === 0 && limit === undefined) {
      return { content: text };
    }
    const lines = text.split('\n');
    const end = limit !== undefined ? Math.min(startLine + limit, lines.length) : lines.length;
    return { content: lines.slice(startLine, end).join('\n') };
  }

  async writeTextFile(params: schema.WriteTextFileRequest): Promise<schema.WriteTextFileResponse> {
    const uri = vscode.Uri.file(params.path);
    let exists = true;
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      exists = false;
    }
    const edit = new vscode.WorkspaceEdit();
    if (!exists) {
      edit.createFile(uri, { overwrite: false, ignoreIfExists: true });
      edit.insert(uri, new vscode.Position(0, 0), params.content);
    } else {
      // openTextDocument is idempotent — returns the in-memory document if already open.
      const doc = await vscode.workspace.openTextDocument(uri);
      const lastLine = doc.lineCount > 0 ? doc.lineAt(doc.lineCount - 1).range.end : new vscode.Position(0, 0);
      edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), lastLine), params.content);
    }
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) throw new Error(`Failed to apply edit to ${params.path}`);
    return {};
  }

  async createTerminal(params: schema.CreateTerminalRequest): Promise<schema.CreateTerminalResponse> {
    return this.terminals.create(params);
  }

  async terminalOutput(params: schema.TerminalOutputRequest): Promise<schema.TerminalOutputResponse> {
    return this.terminals.output(params);
  }

  async waitForTerminalExit(params: schema.WaitForTerminalExitRequest): Promise<schema.WaitForTerminalExitResponse> {
    return this.terminals.waitForExit(params);
  }

  async killTerminal(params: schema.KillTerminalRequest): Promise<schema.KillTerminalResponse> {
    return this.terminals.kill(params);
  }

  async releaseTerminal(params: schema.ReleaseTerminalRequest): Promise<schema.ReleaseTerminalResponse> {
    return this.terminals.release(params);
  }

  /**
   * scode's private extension method. Note: ext requests use string (uuid) ids;
   * the SDK handles the id, we just return the answers payload.
   */
  async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (method === '_scode/ask_user_question') {
      const questions = (params.questions as ScodeQuestion[]) ?? [];
      const answers: Array<{ id: string; value: string; label?: string }> = [];
      for (const q of questions) {
        const answer = await this.askOne(q);
        if (answer) answers.push(answer);
      }
      return { answers };
    }
    return {};
  }

  private async askOne(q: ScodeQuestion): Promise<{ id: string; value: string; label?: string } | null> {
    const hasOptions = Array.isArray(q.options) && q.options.length > 0;
    const kind = q.kind ?? (hasOptions ? 'single_select' : 'text');

    if (kind === 'text' || !hasOptions) {
      const value = await vscode.window.showInputBox({
        title: q.prompt,
        placeHolder: q.customInputHint,
        ignoreFocusOut: true,
      });
      if (value === undefined) return null;
      return { id: q.id, value };
    }

    const items = q.options!.map((o) => ({
      label: o.recommended ? `$(star-full) ${o.label}` : o.label,
      description: o.description,
      value: o.value,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      title: q.prompt,
      canPickMany: kind === 'multi_select',
      ignoreFocusOut: true,
    });
    if (!picked) return null;
    if (Array.isArray(picked)) {
      return { id: q.id, value: picked.map((p) => p.value).join(',') };
    }
    return { id: q.id, value: picked.value, label: picked.label };
  }
}
