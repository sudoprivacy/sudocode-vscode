import type { AskQuestion, HostMessage, PermissionOption, PlanEntry, PromptImage, ToolCall } from './protocol';

export type Item =
  | { kind: 'user'; id: string; text: string; images?: PromptImage[] }
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string }
  | { kind: 'tool'; id: string; tool: ToolCall }
  | { kind: 'plan'; id: string; entries: PlanEntry[] }
  | { kind: 'status'; id: string; text: string }
  | { kind: 'stderr'; id: string; text: string }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'done'; id: string; text: string }
  | {
      kind: 'permission';
      id: string;
      requestId: string;
      toolTitle: string;
      toolKind?: string;
      options: PermissionOption[];
      resolvedOptionId?: string | null;
    }
  | {
      kind: 'question';
      id: string;
      requestId: string;
      questions: AskQuestion[];
      resolved?: boolean;
    };

let counter = 0;
const newId = () => `i${++counter}`;

/** Ensure freshly minted ids don't collide with restored ones. */
export function bumpIdCounter(items: Item[]): void {
  for (const it of items) {
    const m = /^i(\d+)$/.exec(it.id);
    if (m) {
      const n = Number(m[1]);
      if (n > counter) counter = n;
    }
  }
}

/**
 * Reduce a host message into the current list of items.
 *
 * Streaming rule: consecutive `chunk` messages append to the last agent bubble;
 * any non-chunk item breaks the streak. `tool_update` merges into the matching
 * tool item by `toolCallId`.
 */
export function reduce(items: Item[], msg: HostMessage): Item[] {
  switch (msg.type) {
    case 'reset':
      return [];
    case 'user':
      return [...items, { kind: 'user', id: newId(), text: msg.text, images: msg.images }];
    case 'chunk': {
      const last = items[items.length - 1];
      if (last && last.kind === 'agent') {
        return [...items.slice(0, -1), { ...last, text: last.text + msg.text }];
      }
      return [...items, { kind: 'agent', id: newId(), text: msg.text }];
    }
    case 'thought':
      return [...items, { kind: 'thought', id: newId(), text: msg.text }];
    case 'tool': {
      const idx = items.findIndex((i) => i.kind === 'tool' && i.tool.toolCallId === msg.tool.toolCallId);
      if (idx >= 0) {
        const next = items.slice();
        next[idx] = { ...(items[idx] as { kind: 'tool'; id: string }), kind: 'tool', tool: msg.tool };
        return next;
      }
      return [...items, { kind: 'tool', id: newId(), tool: msg.tool }];
    }
    case 'tool_update': {
      const idx = items.findIndex((i) => i.kind === 'tool' && i.tool.toolCallId === msg.toolCallId);
      if (idx < 0) {
        // Defensive: tool_update arrived before tool. Synthesize a stub so the
        // patch isn't lost. Subsequent `tool` for the same id will replace it.
        const stub: ToolCall = {
          toolCallId: msg.toolCallId,
          title: '',
          status: 'pending',
          ...msg.patch,
        };
        return [...items, { kind: 'tool', id: newId(), tool: stub }];
      }
      const current = items[idx] as { kind: 'tool'; id: string; tool: ToolCall };
      const next = items.slice();
      next[idx] = { ...current, tool: { ...current.tool, ...msg.patch } };
      return next;
    }
    case 'plan':
      return [...items, { kind: 'plan', id: newId(), entries: msg.entries }];
    case 'status':
      return [...items, { kind: 'status', id: newId(), text: msg.text }];
    case 'stderr':
      return [...items, { kind: 'stderr', id: newId(), text: msg.text }];
    case 'error':
      return [...items, { kind: 'error', id: newId(), text: msg.text }];
    case 'done':
      return [...items, { kind: 'done', id: newId(), text: msg.text }];
    case 'permission_request':
      return [
        ...items,
        {
          kind: 'permission',
          id: newId(),
          requestId: msg.id,
          toolTitle: msg.toolTitle,
          toolKind: msg.toolKind,
          options: msg.options,
        },
      ];
    case 'permission_resolved': {
      const idx = items.findIndex((i) => i.kind === 'permission' && i.requestId === msg.id);
      if (idx < 0) return items;
      const current = items[idx] as Extract<Item, { kind: 'permission' }>;
      if (current.resolvedOptionId !== undefined) return items;
      const next = items.slice();
      next[idx] = { ...current, resolvedOptionId: msg.optionId };
      return next;
    }
    case 'question_request':
      return [
        ...items,
        {
          kind: 'question',
          id: newId(),
          requestId: msg.id,
          questions: msg.questions,
        },
      ];
    case 'question_resolved': {
      const idx = items.findIndex((i) => i.kind === 'question' && i.requestId === msg.id);
      if (idx < 0) return items;
      const current = items[idx] as Extract<Item, { kind: 'question' }>;
      if (current.resolved) return items;
      const next = items.slice();
      next[idx] = { ...current, resolved: true };
      return next;
    }
    default:
      return items;
  }
}
