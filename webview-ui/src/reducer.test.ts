import { describe, expect, it } from 'vitest';
import { bumpIdCounter, reduce, type Item } from './reducer';
import type { HostMessage, ToolCall } from './protocol';

function fold(messages: HostMessage[], initial: Item[] = []): Item[] {
  return messages.reduce(reduce, initial);
}

const tool = (id: string, extra: Partial<ToolCall> = {}): ToolCall => ({
  toolCallId: id,
  title: extra.title ?? `t-${id}`,
  status: extra.status ?? 'pending',
  ...extra,
});

describe('reduce', () => {
  it('resets on reset', () => {
    const items = fold([
      { type: 'user', text: 'hi' },
      { type: 'chunk', text: 'hello' },
      { type: 'reset' },
    ]);
    expect(items).toEqual([]);
  });

  it('appends consecutive chunks into one agent bubble', () => {
    const items = fold([
      { type: 'user', text: 'q' },
      { type: 'chunk', text: 'a' },
      { type: 'chunk', text: 'b' },
      { type: 'chunk', text: 'c' },
    ]);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ kind: 'agent', text: 'abc' });
  });

  it('breaks the agent streak on any non-chunk', () => {
    const items = fold([
      { type: 'chunk', text: 'a' },
      { type: 'status', text: 'pause' },
      { type: 'chunk', text: 'b' },
    ]);
    expect(items.map((i) => i.kind)).toEqual(['agent', 'status', 'agent']);
    expect((items[2] as Extract<Item, { kind: 'agent' }>).text).toBe('b');
  });

  it('merges tool_update into the matching tool by id', () => {
    const items = fold([
      { type: 'tool', tool: tool('1', { status: 'pending' }) },
      { type: 'tool_update', toolCallId: '1', patch: { status: 'completed', title: 'done' } },
    ]);
    expect(items).toHaveLength(1);
    expect((items[0] as Extract<Item, { kind: 'tool' }>).tool).toMatchObject({ status: 'completed', title: 'done' });
  });

  it('synthesizes a stub when tool_update arrives before tool', () => {
    const items = fold([
      { type: 'tool_update', toolCallId: '7', patch: { status: 'in_progress', title: 'early' } },
    ]);
    expect(items).toHaveLength(1);
    const t = (items[0] as Extract<Item, { kind: 'tool' }>).tool;
    expect(t.toolCallId).toBe('7');
    expect(t.title).toBe('early');
    expect(t.status).toBe('in_progress');
  });

  it('replaces stub when matching tool follows', () => {
    const items = fold([
      { type: 'tool_update', toolCallId: '7', patch: { status: 'in_progress' } },
      { type: 'tool', tool: tool('7', { title: 'real', status: 'completed' }) },
    ]);
    expect(items).toHaveLength(1);
    expect((items[0] as Extract<Item, { kind: 'tool' }>).tool.title).toBe('real');
  });

  it('appends an interrupted notice after a half-streamed agent bubble', () => {
    const items = fold([
      { type: 'user', text: 'q' },
      { type: 'chunk', text: 'partial ' },
      { type: 'chunk', text: 'answer' },
      { type: 'interrupted', text: 'The view reloaded; the message above may be incomplete.' },
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'agent', 'interrupted']);
    expect((items[1] as Extract<Item, { kind: 'agent' }>).text).toBe('partial answer');
    const notice = items[2] as Extract<Item, { kind: 'interrupted' }>;
    expect(notice.kind).toBe('interrupted');
    expect(notice.text).toContain('may be incomplete');
  });

  it('resolves a permission once', () => {
    const items = fold([
      {
        type: 'permission_request',
        id: 'p1',
        toolTitle: 'Run bash',
        options: [{ optionId: 'allow_once', name: 'Allow once' }],
      },
      { type: 'permission_resolved', id: 'p1', optionId: 'allow_once' },
      { type: 'permission_resolved', id: 'p1', optionId: 'reject_once' },
    ]);
    const perm = items[0] as Extract<Item, { kind: 'permission' }>;
    expect(perm.resolvedOptionId).toBe('allow_once');
  });

  it('resolves a question once', () => {
    const items = fold([
      {
        type: 'question_request',
        id: 'q1',
        questions: [{ id: 'a', prompt: 'Pick one', kind: 'single_select', options: [{ label: 'X', value: 'x' }] }],
      },
      { type: 'question_resolved', id: 'q1' },
      { type: 'question_resolved', id: 'q1' },
    ]);
    expect(items).toHaveLength(1);
    const q = items[0] as Extract<Item, { kind: 'question' }>;
    expect(q.kind).toBe('question');
    expect(q.resolved).toBe(true);
  });

  it('keeps pasted images on the user item', () => {
    const items = fold([
      { type: 'user', text: 'look', images: [{ mimeType: 'image/png', data: 'AAAA' }] },
    ]);
    const u = items[0] as Extract<Item, { kind: 'user' }>;
    expect(u.images).toEqual([{ mimeType: 'image/png', data: 'AAAA' }]);
  });

  it('bumpIdCounter avoids id collisions after restore', () => {
    const restored: Item[] = [{ kind: 'user', id: 'i42', text: 'old' }];
    bumpIdCounter(restored);
    const after = reduce(restored, { type: 'user', text: 'new' });
    expect(after).toHaveLength(2);
    const ids = after.map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
    const newIdMatch = /^i(\d+)$/.exec(after[1].id);
    expect(newIdMatch).not.toBeNull();
    expect(Number(newIdMatch![1])).toBeGreaterThan(42);
  });
});
