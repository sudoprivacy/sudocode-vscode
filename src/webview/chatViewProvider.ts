import { readdirSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type * as schema from '@agentclientprotocol/sdk';
import {
  getWorkspaceFolders,
  SudocodeSession,
  type AskAnswer,
  type AskQuestion,
  type PermissionRequest,
  type PromptImage,
} from '../acp/session';

type AuthMode = 'auto' | 'subscription' | 'proxy' | 'api-key';
type PermissionMode = 'default' | 'read-only' | 'workspace-write' | 'danger-full-access';

interface PendingPermission {
  resolve(value: { optionId: string | null }): void;
  folder: string;
}

interface PendingQuestion {
  resolve(value: { answers: AskAnswer[] | null }): void;
  folder: string;
}

/** Extract as much detail as possible from a thrown value (JSON-RPC errors carry code/data). */
function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; code?: unknown; data?: unknown; stack?: string };
    const parts: string[] = [];
    if (e.message) parts.push(e.message);
    if (e.code !== undefined) parts.push(`code=${JSON.stringify(e.code)}`);
    if (e.data !== undefined) parts.push(`data=${JSON.stringify(e.data)}`);
    if (parts.length === 0 && e.stack) parts.push(e.stack);
    if (parts.length > 0) return parts.join(' ');
  }
  return err instanceof Error ? err.message : String(err);
}

/** Translate noisy stderr lines into a one-line user hint (or null to skip). */
function translateStderrHint(line: string): string | null {
  const lower = line.toLowerCase();
  if (/\b401\b|unauthor|invalid api key|invalid token|authentication failed/.test(lower)) {
    return 'Sudocode: authentication failed. Run `scode login` in a terminal, or set PROXY_AUTH_TOKEN / ANTHROPIC_API_KEY.';
  }
  if (/\b403\b|forbidden|quota|rate.?limit/.test(lower)) {
    return 'Sudocode: provider rejected the request (403 / quota / rate limit). Check account status or wait.';
  }
  if (/enoent|no such file or directory/.test(lower) && /scode/.test(lower)) {
    return 'Sudocode: scode binary not found. Check the `sudocode.cliPath` setting.';
  }
  return null;
}

/** Sidebar webview that renders the chat and drives a SudocodeSession. */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sudocode.chatView';

  private view?: vscode.WebviewView;
  private sessions = new Map<string, SudocodeSession>();
  private activeFolder?: string;
  private pendingPermissions = new Map<string, PendingPermission>();
  private permissionCounter = 0;
  private pendingQuestions = new Map<string, PendingQuestion>();
  private questionCounter = 0;
  private shownHints = new Set<string>();
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    webviewView.webview.html = this.html(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (msg: {
        type: string;
        text?: string;
        id?: string;
        optionId?: string | null;
        answers?: AskAnswer[] | null;
        mentions?: string[];
        images?: PromptImage[];
        requestId?: number;
        query?: string;
        folder?: string;
      }) => {
        if (msg.type === 'prompt' && msg.text !== undefined) {
          await this.handlePrompt(msg.text, msg.mentions ?? [], msg.images ?? []);
        } else if (msg.type === 'cancel') {
          const session = this.activeFolder ? this.sessions.get(this.activeFolder) : undefined;
          if (session) {
            this.post({ type: 'status', text: 'Cancel requested…' }, this.activeFolder);
            await session.cancel();
          }
        } else if (msg.type === 'restart') {
          await this.restart();
        } else if (msg.type === 'select_folder' && msg.folder) {
          this.activeFolder = msg.folder;
        } else if (msg.type === 'search_files' && typeof msg.requestId === 'number') {
          await this.searchFiles(msg.requestId, msg.query ?? '');
        } else if (msg.type === 'permission_response' && msg.id) {
          const pending = this.pendingPermissions.get(msg.id);
          if (pending) {
            this.pendingPermissions.delete(msg.id);
            pending.resolve({ optionId: msg.optionId ?? null });
          }
        } else if (msg.type === 'question_response' && msg.id) {
          const pending = this.pendingQuestions.get(msg.id);
          if (pending) {
            this.pendingQuestions.delete(msg.id);
            pending.resolve({ answers: msg.answers ?? null });
          }
        }
      },
    );

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.syncFolders()),
    );

    webviewView.onDidDispose(() => {
      this.resolveAllPending(null);
      for (const s of this.sessions.values()) s.dispose();
      this.sessions.clear();
      for (const d of this.disposables) d.dispose();
      this.disposables = [];
    });

    this.syncFolders();
  }

  /** Push the current workspace-folder list to the webview, picking a default active folder. */
  private syncFolders(): void {
    const folders = getWorkspaceFolders();
    const known = new Set(folders.map((f) => f.path));
    // Drop sessions for folders that no longer exist.
    for (const [folder, session] of this.sessions) {
      if (!known.has(folder)) {
        session.dispose();
        this.sessions.delete(folder);
      }
    }
    if (!this.activeFolder || !known.has(this.activeFolder)) {
      this.activeFolder = folders[0]?.path;
    }
    this.post({ type: 'folders', folders, active: this.activeFolder ?? '' });
  }

  async restart(): Promise<void> {
    const folder = this.activeFolder;
    this.resolveAllPending(null, folder);
    if (folder) {
      this.sessions.get(folder)?.dispose();
      this.sessions.delete(folder);
    }
    this.shownHints.clear();
    this.post({ type: 'reset' }, folder);
    this.post({ type: 'status', text: 'Agent restarted.' }, folder);
  }

  /** Insert a markdown snippet into the chat input and focus the panel. */
  prefill(text: string): void {
    this.view?.show?.(true);
    this.post({ type: 'prefill', text });
  }

  private async ensureSession(folder: string): Promise<SudocodeSession> {
    const existing = this.sessions.get(folder);
    if (existing) return existing;

    const cfg = vscode.workspace.getConfiguration('sudocode');
    const session = new SudocodeSession(
      folder,
      {
        onUpdate: (u) => this.handleUpdate(folder, u),
        onExit: ({ code, signal }) => {
          this.resolveAllPending(null, folder);
          this.post({ type: 'status', text: `Agent exited (code=${code}, signal=${signal}).` }, folder);
          this.sessions.delete(folder);
        },
        onStderr: (line) => {
          console.error('[scode]', line);
          this.post({ type: 'stderr', text: line }, folder);
          const hint = translateStderrHint(line);
          if (hint && !this.shownHints.has(hint)) {
            this.shownHints.add(hint);
            this.post({ type: 'error', text: hint }, folder);
          }
        },
        onRequestPermission: (req) => this.requestPermission(folder, req),
        onAskQuestions: (questions) => this.askQuestions(folder, questions),
      },
      { cliPath: cfg.get<string>('cliPath') || undefined,
        authMode: cfg.get<AuthMode>('authMode') ?? 'auto',
        permissionMode: cfg.get<PermissionMode>('permissionMode') ?? 'default',
        model: cfg.get<string>('model') || undefined,
        extraArgs: cfg.get<string[]>('extraArgs') ?? [],
      },
    );
    await session.start();
    this.sessions.set(folder, session);
    return session;
  }

  private async handlePrompt(text: string, mentions: string[] = [], images: PromptImage[] = []): Promise<void> {
    const folder = this.activeFolder;
    if (!folder) {
      this.post({
        type: 'error',
        text: 'Sudocode 需要先在 VS Code 里打开一个工作区文件夹（File > Open Folder…），它会作为 agent 的工作目录。',
      });
      return;
    }
    this.post({ type: 'user', text, images: images.length > 0 ? images : undefined }, folder);
    let phase = 'start';
    try {
      const session = await this.ensureSession(folder);
      phase = 'prompt';
      if (images.length > 0 && !session.supportsImages) {
        this.post({
          type: 'status',
          text: 'This agent did not advertise image support; pasted images were not sent.',
        }, folder);
      }
      const result = await session.prompt(text, mentions, images);
      this.post({ type: 'done', text: result.stopReason }, folder);
    } catch (err) {
      this.post({ type: 'error', text: `[${phase}] ${describeError(err)}` }, folder);
    }
  }

  /** Fuzzy-ish file search for @-mentions, scoped to the active folder. */
  private async searchFiles(requestId: number, query: string): Promise<void> {
    const folder = this.activeFolder;
    let files: string[] = [];
    try {
      const glob = query ? `**/*${query.replace(/[\\]/g, '/')}*` : '**/*';
      const include = folder ? new vscode.RelativePattern(vscode.Uri.file(folder), glob) : glob;
      const uris = await vscode.workspace.findFiles(include, '**/{node_modules,.git,dist,out}/**', 30);
      files = uris
        .map((u) => (folder ? path.relative(folder, u.fsPath) : vscode.workspace.asRelativePath(u, false)))
        .sort((a, b) => a.length - b.length);
    } catch {
      files = [];
    }
    this.post({ type: 'file_results', requestId, query, files });
  }

  private handleUpdate(folder: string, params: schema.SessionNotification): void {
    const update = params.update;
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') this.post({ type: 'chunk', text: update.content.text }, folder);
        break;
      case 'agent_thought_chunk':
        if (update.content.type === 'text') this.post({ type: 'thought', text: update.content.text }, folder);
        break;
      case 'tool_call':
        this.post({
          type: 'tool',
          tool: {
            toolCallId: update.toolCallId,
            title: update.title,
            status: update.status ?? 'pending',
            kind: update.kind,
            rawInput: update.rawInput,
            rawOutput: update.rawOutput,
            content: update.content,
            locations: update.locations,
          },
        }, folder);
        break;
      case 'tool_call_update': {
        const patch: Record<string, unknown> = {};
        if (update.title != null) patch.title = update.title;
        if (update.status != null) patch.status = update.status;
        if (update.kind != null) patch.kind = update.kind;
        if (update.rawInput !== undefined) patch.rawInput = update.rawInput;
        if (update.rawOutput !== undefined) patch.rawOutput = update.rawOutput;
        if (update.content != null) patch.content = update.content;
        if (update.locations != null) patch.locations = update.locations;
        this.post({ type: 'tool_update', toolCallId: update.toolCallId, patch }, folder);
        break;
      }
      case 'plan':
        this.post({ type: 'plan', entries: update.entries }, folder);
        break;
      default:
        break;
    }
  }

  private post(message: Record<string, unknown>, folder?: string): void {
    this.view?.webview.postMessage(folder ? { ...message, folder } : message);
  }

  private requestPermission(folder: string, req: PermissionRequest): Promise<{ optionId: string | null }> {
    this.view?.show?.(true);
    const id = `p${++this.permissionCounter}`;
    return new Promise<{ optionId: string | null }>((resolve) => {
      this.pendingPermissions.set(id, { resolve, folder });
      this.post({
        type: 'permission_request',
        id,
        toolTitle: req.toolTitle,
        toolKind: req.toolKind,
        options: req.options,
      }, folder);
    });
  }

  private resolveAllPending(optionId: string | null, folder?: string): void {
    for (const [id, p] of this.pendingPermissions) {
      if (folder && p.folder !== folder) continue;
      this.post({ type: 'permission_resolved', id, optionId }, p.folder);
      p.resolve({ optionId });
      this.pendingPermissions.delete(id);
    }
    for (const [id, p] of this.pendingQuestions) {
      if (folder && p.folder !== folder) continue;
      this.post({ type: 'question_resolved', id }, p.folder);
      p.resolve({ answers: null });
      this.pendingQuestions.delete(id);
    }
  }

  private askQuestions(folder: string, questions: AskQuestion[]): Promise<{ answers: AskAnswer[] | null }> {
    this.view?.show?.(true);
    const id = `q${++this.questionCounter}`;
    return new Promise<{ answers: AskAnswer[] | null }>((resolve) => {
      this.pendingQuestions.set(id, { resolve, folder });
      this.post({ type: 'question_request', id, questions }, folder);
    });
  }

  /**
   * Builds the webview HTML by discovering the Vite-built JS/CSS in dist/webview/assets
   * (the filenames have content hashes) and wiring them with a strict CSP + nonce.
   */
  private html(webview: vscode.Webview): string {
    const webviewDir = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const assetsDir = vscode.Uri.joinPath(webviewDir, 'assets');
    let jsName: string | undefined;
    let cssName: string | undefined;
    try {
      for (const f of readdirSync(assetsDir.fsPath)) {
        if (f.endsWith('.js') && !f.endsWith('.map')) jsName = f;
        else if (f.endsWith('.css')) cssName = f;
      }
    } catch (err) {
      return missingBuildHtml(err);
    }
    if (!jsName) return missingBuildHtml(new Error('no JS bundle found in dist/webview/assets'));

    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsDir, jsName));
    const cssUri = cssName ? webview.asWebviewUri(vscode.Uri.joinPath(assetsDir, cssName)) : undefined;
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${cssUri ? `<link rel="stylesheet" href="${cssUri}" />` : ''}
<title>Sudocode Chat</title>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  let s = '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function missingBuildHtml(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `<!DOCTYPE html>
<html><body style="font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-errorForeground);">
<h3>Webview build missing</h3>
<p>Run <code>npm run build</code> in the extension repo to produce <code>dist/webview/</code>.</p>
<pre>${detail.replace(/</g, '&lt;')}</pre>
</body></html>`;
}
