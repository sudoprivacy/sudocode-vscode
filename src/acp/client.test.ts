import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as schema from '@agentclientprotocol/sdk';
import { SudocodeClient, type ClientHost } from './client';
import { Position, Range, resetVscodeMock, workspace, WorkspaceEdit } from '../test/vscode-mock';

function makeHost(): ClientHost & {
  onSessionUpdate: ReturnType<typeof vi.fn>;
  onRequestPermission: ReturnType<typeof vi.fn>;
  onAskQuestions: ReturnType<typeof vi.fn>;
} {
  return {
    onSessionUpdate: vi.fn(),
    onRequestPermission: vi.fn(async () => ({ optionId: null })),
    onAskQuestions: vi.fn(async () => ({ answers: [] })),
  };
}

beforeEach(() => {
  resetVscodeMock();
});

describe('requestPermission', () => {
  it('returns a selected outcome when the host picks an option', async () => {
    const host = makeHost();
    host.onRequestPermission.mockResolvedValueOnce({ optionId: 'allow' });
    const client = new SudocodeClient(host);

    const params = {
      toolCall: { title: 'Run rm -rf', kind: 'execute' },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    } as unknown as schema.RequestPermissionRequest;

    const res = await client.requestPermission(params);

    expect(res).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    expect(host.onRequestPermission).toHaveBeenCalledWith({
      toolTitle: 'Run rm -rf',
      toolKind: 'execute',
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    });
  });

  it('returns a cancelled outcome when the host resolves with optionId null', async () => {
    const host = makeHost();
    host.onRequestPermission.mockResolvedValueOnce({ optionId: null });
    const client = new SudocodeClient(host);

    const res = await client.requestPermission({
      toolCall: { title: 'Edit file', kind: 'edit' },
      options: [{ optionId: 'allow', name: 'Allow' }],
    } as unknown as schema.RequestPermissionRequest);

    expect(res).toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('falls back to a default title and undefined kind when toolCall is absent', async () => {
    const host = makeHost();
    host.onRequestPermission.mockResolvedValueOnce({ optionId: 'allow' });
    const client = new SudocodeClient(host);

    await client.requestPermission({
      options: [{ optionId: 'allow', name: 'Allow' }],
    } as unknown as schema.RequestPermissionRequest);

    expect(host.onRequestPermission).toHaveBeenCalledWith({
      toolTitle: 'Sudocode wants to run a tool',
      toolKind: undefined,
      options: [{ optionId: 'allow', name: 'Allow', kind: undefined }],
    });
  });
});

describe('writeTextFile', () => {
  it('creates and inserts when the file does not exist', async () => {
    const host = makeHost();
    workspace.fs.stat.mockRejectedValueOnce(new Error('ENOENT'));
    const client = new SudocodeClient(host);

    const res = await client.writeTextFile({
      path: '/tmp/new.txt',
      content: 'hello',
    } as unknown as schema.WriteTextFileRequest);

    expect(res).toEqual({});
    expect(workspace.openTextDocument).not.toHaveBeenCalled();
    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);

    const edit = workspace.applyEdit.mock.calls[0][0] as WorkspaceEdit;
    expect(edit.createFile).toHaveBeenCalledTimes(1);
    expect(edit.createFile.mock.calls[0][0].fsPath).toBe('/tmp/new.txt');
    expect(edit.createFile.mock.calls[0][1]).toEqual({ overwrite: false, ignoreIfExists: true });
    expect(edit.insert).toHaveBeenCalledTimes(1);
    const [, position, content] = edit.insert.mock.calls[0];
    expect(position).toBeInstanceOf(Position);
    expect(position).toMatchObject({ line: 0, character: 0 });
    expect(content).toBe('hello');
    expect(edit.replace).not.toHaveBeenCalled();
  });

  it('replaces the full range when the file exists', async () => {
    const host = makeHost();
    workspace.fs.stat.mockResolvedValueOnce({});
    workspace.openTextDocument.mockResolvedValueOnce({
      lineCount: 3,
      lineAt: (_n: number) => ({ range: { end: new Position(2, 7) } }),
      getText: () => 'old',
    });
    const client = new SudocodeClient(host);

    const res = await client.writeTextFile({
      path: '/tmp/exists.txt',
      content: 'replaced',
    } as unknown as schema.WriteTextFileRequest);

    expect(res).toEqual({});
    expect(workspace.openTextDocument).toHaveBeenCalledTimes(1);
    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);

    const edit = workspace.applyEdit.mock.calls[0][0] as WorkspaceEdit;
    expect(edit.createFile).not.toHaveBeenCalled();
    expect(edit.insert).not.toHaveBeenCalled();
    expect(edit.replace).toHaveBeenCalledTimes(1);
    const [uri, range, content] = edit.replace.mock.calls[0];
    expect(uri.fsPath).toBe('/tmp/exists.txt');
    expect(range).toBeInstanceOf(Range);
    expect(range.start).toMatchObject({ line: 0, character: 0 });
    expect(range.end).toMatchObject({ line: 2, character: 7 });
    expect(content).toBe('replaced');
  });

  it('throws when applyEdit returns false', async () => {
    const host = makeHost();
    workspace.fs.stat.mockRejectedValueOnce(new Error('ENOENT'));
    workspace.applyEdit.mockResolvedValueOnce(false);
    const client = new SudocodeClient(host);

    await expect(
      client.writeTextFile({
        path: '/tmp/fail.txt',
        content: 'x',
      } as unknown as schema.WriteTextFileRequest),
    ).rejects.toThrow('Failed to apply edit to /tmp/fail.txt');
  });
});

describe('extMethod (_scode/ask_user_question)', () => {
  it('returns empty answers without asking the host when there are no questions', async () => {
    const host = makeHost();
    const client = new SudocodeClient(host);

    const res = await client.extMethod('_scode/ask_user_question', { questions: [] });

    expect(res).toEqual({ answers: [] });
    expect(host.onAskQuestions).not.toHaveBeenCalled();
  });

  it('forwards questions to the host and returns its answers', async () => {
    const host = makeHost();
    const answers = [{ id: 'q1', value: 'yes', label: 'Yes' }];
    host.onAskQuestions.mockResolvedValueOnce({ answers });
    const client = new SudocodeClient(host);

    const questions = [{ id: 'q1', prompt: 'Proceed?', kind: 'boolean' }];
    const res = await client.extMethod('_scode/ask_user_question', { questions });

    expect(host.onAskQuestions).toHaveBeenCalledWith(questions);
    expect(res).toEqual({ answers });
  });

  it('coerces a null host answer into an empty array', async () => {
    const host = makeHost();
    host.onAskQuestions.mockResolvedValueOnce({ answers: null });
    const client = new SudocodeClient(host);

    const res = await client.extMethod('_scode/ask_user_question', {
      questions: [{ id: 'q1', prompt: 'Pick one' }],
    });

    expect(res).toEqual({ answers: [] });
  });

  it('returns an empty object for unknown methods', async () => {
    const host = makeHost();
    const client = new SudocodeClient(host);

    const res = await client.extMethod('_scode/something_else', { foo: 'bar' });

    expect(res).toEqual({});
    expect(host.onAskQuestions).not.toHaveBeenCalled();
  });
});
