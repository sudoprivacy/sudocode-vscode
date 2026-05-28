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

export interface FolderInfo {
  /** Absolute fsPath of the workspace folder — the routing key. */
  path: string;
  /** Display name (folder basename). */
  name: string;
}

/**
 * Item-mutating host messages carry an optional `folder` so the webview can
 * route them to the right per-folder history. Absent means the active folder.
 */
export type HostMessage =
  | { type: 'folders'; folders: FolderInfo[]; active: string }
  | { type: 'user'; text: string; images?: PromptImage[] }
  | { type: 'chunk'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool'; tool: ToolCall }
  | { type: 'tool_update'; toolCallId: string; patch: Partial<ToolCall> }
  | { type: 'plan'; entries: PlanEntry[] }
  | { type: 'status'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done'; text: string }
  | { type: 'interrupted'; text: string }
  | { type: 'reset' }
  | { type: 'prefill'; text: string }
  | {
      type: 'permission_request';
      id: string;
      toolTitle: string;
      toolKind?: string;
      options: PermissionOption[];
    }
  | { type: 'permission_resolved'; id: string; optionId: string | null }
  | { type: 'question_request'; id: string; questions: AskQuestion[] }
  | { type: 'question_resolved'; id: string }
  | { type: 'file_results'; requestId: number; query: string; files: string[] };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'prompt'; text: string; mentions?: string[]; images?: PromptImage[] }
  | { type: 'cancel' }
  | { type: 'restart' }
  | { type: 'select_folder'; folder: string }
  | { type: 'search_files'; requestId: number; query: string }
  | { type: 'permission_response'; id: string; optionId: string | null }
  | { type: 'question_response'; id: string; answers: AskAnswer[] | null };

export interface VsCodeApi {
  postMessage(msg: WebviewMessage): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}
