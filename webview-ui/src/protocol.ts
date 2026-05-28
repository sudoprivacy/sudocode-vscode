/** Message protocol between the extension host and the webview. */

export interface ToolCall {
  toolCallId: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | string;
  kind?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: unknown;
  locations?: unknown;
}

export interface PlanEntry {
  content: string;
  status: string;
  priority?: string;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind?: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string;
}

export type HostMessage =
  | { type: 'user'; text: string }
  | { type: 'chunk'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool'; tool: ToolCall }
  | { type: 'tool_update'; toolCallId: string; patch: Partial<ToolCall> }
  | { type: 'plan'; entries: PlanEntry[] }
  | { type: 'status'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done'; text: string }
  | { type: 'reset' }
  | { type: 'prefill'; text: string }
  | {
      type: 'permission_request';
      id: string;
      toolTitle: string;
      toolKind?: string;
      options: PermissionOption[];
    }
  | { type: 'permission_resolved'; id: string; optionId: string | null };

export type WebviewMessage =
  | { type: 'prompt'; text: string }
  | { type: 'cancel' }
  | { type: 'restart' }
  | { type: 'permission_response'; id: string; optionId: string | null };

export interface VsCodeApi {
  postMessage(msg: WebviewMessage): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}
