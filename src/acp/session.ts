import { Readable, Writable } from 'node:stream';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import * as acp from '@agentclientprotocol/sdk';
import type * as schema from '@agentclientprotocol/sdk';
import { type SpawnedScode, spawnScodeAcp, type AuthMode, type PermissionMode } from './spawn';
import { SudocodeClient } from './client';

export interface PermissionRequest {
  toolTitle: string;
  toolKind?: string;
  options: Array<{ optionId: string; name: string; kind?: string }>;
}

export interface AskQuestion {
  id: string;
  prompt: string;
  kind?: 'single_select' | 'multi_select' | 'text' | 'boolean';
  required?: boolean;
  allowCustomInput?: boolean;
  customInputHint?: string;
  options?: Array<{ label: string; value: string; description?: string; recommended?: boolean }>;
}

export interface AskAnswer {
  id: string;
  value: string;
  label?: string;
}

export interface PromptImage {
  mimeType: string;
  /** base64-encoded image bytes (no data: prefix). */
  data: string;
}

export interface SessionEvents {
  onUpdate(update: schema.SessionNotification): void;
  onExit(info: { code: number | null; signal: NodeJS.Signals | null }): void;
  onStderr(line: string): void;
  /** Resolve with the chosen optionId, or null to cancel/reject. */
  onRequestPermission(req: PermissionRequest): Promise<{ optionId: string | null }>;
  /** Ask the user one or more questions inline. Resolve with answers, or null to cancel. */
  onAskQuestions(questions: AskQuestion[]): Promise<{ answers: AskAnswer[] | null }>;
}

/** One scode ACP process + connection + session, tied to a workspace folder. */
export class SudocodeSession {
  private spawned?: SpawnedScode;
  private connection?: acp.ClientSideConnection;
  private client?: SudocodeClient;
  private sessionId?: string;
  private disposed = false;
  private imageSupported = false;

  constructor(
    private readonly cwd: string,
    private readonly events: SessionEvents,
    private readonly config: {
      cliPath?: string;
      authMode?: AuthMode;
      permissionMode?: PermissionMode;
      model?: string;
      extraArgs?: string[];
    },
  ) {}

  async start(): Promise<void> {
    const spawned = spawnScodeAcp({
      cliPath: this.config.cliPath,
      cwd: this.cwd,
      authMode: this.config.authMode,
      permissionMode: this.config.permissionMode,
      model: this.config.model,
      extraArgs: this.config.extraArgs,
    });
    this.spawned = spawned;

    spawned.child.stderr.setEncoding('utf-8');
    spawned.child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) this.events.onStderr(line);
      }
    });
    spawned.child.on('exit', (code, signal) => {
      if (!this.disposed) this.events.onExit({ code, signal });
    });
    spawned.child.on('error', (err) => {
      this.events.onStderr(`[spawn error] ${err.message}`);
    });

    const client = new SudocodeClient({
      onSessionUpdate: (u) => this.events.onUpdate(u),
      onRequestPermission: (req) => this.events.onRequestPermission(req),
      onAskQuestions: (questions) => this.events.onAskQuestions(questions),
    });
    this.client = client;

    // ndJsonStream(writableToAgent, readableFromAgent)
    const toAgent = Writable.toWeb(spawned.child.stdin) as WritableStream<Uint8Array>;
    const fromAgent = Readable.toWeb(spawned.child.stdout) as unknown as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(toAgent, fromAgent);

    const connection = new acp.ClientSideConnection(() => client, stream);
    this.connection = connection;

    const init = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        // terminal capability intentionally not advertised: scode 0.1.7 ignores
        // it (runs bash internally and returns rawOutput). TerminalManager and
        // the client-side methods remain in the codebase for future agents.
      },
    });
    this.imageSupported = init.agentCapabilities?.promptCapabilities?.image === true;

    const session = await connection.newSession({ cwd: this.cwd, mcpServers: [] });
    this.sessionId = session.sessionId;
  }

  /** True if the agent advertised support for image content blocks at initialize. */
  get supportsImages(): boolean {
    return this.imageSupported;
  }

  async prompt(text: string, mentions: string[] = [], images: PromptImage[] = []): Promise<schema.PromptResponse> {
    if (!this.connection || !this.sessionId) throw new Error('Session not started');
    const prompt: schema.ContentBlock[] = [];
    if (text) prompt.push({ type: 'text', text });
    for (const rel of mentions) {
      const abs = path.isAbsolute(rel) ? rel : path.join(this.cwd, rel);
      prompt.push({
        type: 'resource_link',
        uri: pathToFileURL(abs).toString(),
        name: rel,
      });
    }
    if (this.imageSupported) {
      for (const img of images) {
        prompt.push({ type: 'image', data: img.data, mimeType: img.mimeType });
      }
    }
    if (prompt.length === 0) prompt.push({ type: 'text', text: '' });
    return this.connection.prompt({ sessionId: this.sessionId, prompt });
  }

  async cancel(): Promise<void> {
    if (!this.connection || !this.sessionId) return;
    await this.connection.cancel({ sessionId: this.sessionId });
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.client?.dispose();
    } catch {
      // best-effort
    }
    try {
      this.spawned?.child.kill();
    } catch {
      // best-effort
    }
    this.spawned = undefined;
    this.connection = undefined;
    this.client = undefined;
    this.sessionId = undefined;
  }
}

export function getWorkspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getWorkspaceFolders(): Array<{ path: string; name: string }> {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    path: f.uri.fsPath,
    name: f.name,
  }));
}
