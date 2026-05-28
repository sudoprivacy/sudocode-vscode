/**
 * Minimal `vscode` stand-in for vitest. Wired up via a vite `resolve.alias`
 * (see vitest.config.ts) so the bare `import * as vscode from 'vscode'` in
 * client.ts / terminalManager.ts resolves during unit tests.
 *
 * Only the surface actually touched by the code under test is implemented. The
 * recording classes (WorkspaceEdit) and configurable hooks (fs.stat,
 * applyEdit, openTextDocument) let tests assert calls and steer both branches
 * of writeTextFile. Anything left unimplemented throws so accidental reliance
 * surfaces loudly instead of silently passing.
 */
import { vi } from 'vitest';

export class Uri {
  private constructor(public readonly fsPath: string) {}
  static file(path: string): Uri {
    return new Uri(path);
  }
}

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  constructor(public readonly start: Position, public readonly end: Position) {}
}

/** Records the edits applied so tests can assert what client.ts built. */
export class WorkspaceEdit {
  createFile = vi.fn((_uri: Uri, _opts?: { overwrite?: boolean; ignoreIfExists?: boolean }) => {});
  insert = vi.fn((_uri: Uri, _position: Position, _content: string) => {});
  replace = vi.fn((_uri: Uri, _range: Range, _content: string) => {});
}

export class EventEmitter<T> {
  event = (_listener: (e: T) => void): { dispose: () => void } => ({ dispose: () => {} });
  fire(_data: T): void {}
  dispose(): void {}
}

/** The slice of vscode.TextDocument that writeTextFile reads. */
export interface TextDocumentLike {
  lineCount: number;
  lineAt(n: number): { range: { end: Position } };
  getText(): string;
}

/**
 * Per-test controllable hooks. Tests reach in and configure these mocks
 * (e.g. `fs.stat.mockRejectedValueOnce(...)`, `applyEdit.mockResolvedValue(false)`).
 */
export const workspace = {
  fs: {
    stat: vi.fn(async (_uri: Uri) => ({})),
    readFile: vi.fn(async (_uri: Uri) => new Uint8Array()),
  },
  textDocuments: [] as Array<{ uri: Uri; getText(): string }>,
  openTextDocument: vi.fn(async (_uri: Uri): Promise<TextDocumentLike> => ({
    lineCount: 1,
    lineAt: (_n: number) => ({ range: { end: new Position(0, 0) } }),
    getText: () => '',
  })),
  applyEdit: vi.fn(async (_edit: WorkspaceEdit): Promise<boolean> => true),
};

export const window = {
  createTerminal: vi.fn((_opts: unknown) => ({ show: () => {}, dispose: () => {} })),
};

/** Reset all configurable mocks to their defaults. Call from `beforeEach`. */
export function resetVscodeMock(): void {
  workspace.fs.stat.mockReset();
  workspace.fs.stat.mockResolvedValue({});
  workspace.fs.readFile.mockReset();
  workspace.fs.readFile.mockResolvedValue(new Uint8Array());
  workspace.textDocuments = [];
  workspace.openTextDocument.mockReset();
  workspace.openTextDocument.mockResolvedValue({
    lineCount: 1,
    lineAt: (_n: number) => ({ range: { end: new Position(0, 0) } }),
    getText: () => '',
  } as TextDocumentLike);
  workspace.applyEdit.mockReset();
  workspace.applyEdit.mockResolvedValue(true);
  window.createTerminal.mockReset();
}
