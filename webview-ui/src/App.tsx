import React, { useEffect, useReducer, useRef, useState } from 'react';
import type { HostMessage } from './protocol';
import { bumpIdCounter, reduce, type Item } from './reducer';
import { Markdown } from './components/Markdown';
import { ToolCard } from './components/ToolCard';
import { ChatInput, type ChatInputHandle } from './components/ChatInput';

const vscode = acquireVsCodeApi();

interface PersistedState {
  items: Item[];
  input: string;
}

function loadState(): PersistedState {
  const raw = vscode.getState<PersistedState>();
  if (raw && Array.isArray(raw.items)) {
    bumpIdCounter(raw.items);
    return { items: raw.items, input: typeof raw.input === 'string' ? raw.input : '' };
  }
  return { items: [], input: '' };
}

const initial = loadState();

export function App(): React.ReactElement {
  const [items, dispatch] = useReducer(reduce, initial.items);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState(initial.input);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);

  useEffect(() => {
    vscode.setState<PersistedState>({ items, input });
  }, [items, input]);

  useEffect(() => {
    if (initial.items.length > 0) {
      dispatch({
        type: 'status',
        text: '(Restored from previous webview state — the agent process was reset, so the model will not remember this conversation.)',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent<HostMessage>) {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'prefill') {
        setInput((prev) => (prev ? prev + '\n\n' + msg.text : msg.text));
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      dispatch(msg);
      if (msg.type === 'done' || msg.type === 'error') setBusy(false);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  function onSend(text: string) {
    setBusy(true);
    setInput('');
    vscode.postMessage({ type: 'prompt', text });
  }

  function onCancel() {
    vscode.postMessage({ type: 'cancel' });
  }

  function onLocalCommand(name: 'clear' | 'help') {
    if (name === 'clear') {
      vscode.postMessage({ type: 'restart' });
      return;
    }
    if (name === 'help') {
      dispatch({
        type: 'status',
        text:
          'Sudocode commands: /clear to reset chat & restart agent · /help to show this message · /compact /cost /model are forwarded to scode. Settings: search "sudocode" in VS Code settings to change permission mode, model, CLI path.',
      });
    }
  }

  function onPermissionChoice(requestId: string, optionId: string | null) {
    vscode.postMessage({ type: 'permission_response', id: requestId, optionId });
    dispatch({ type: 'permission_resolved', id: requestId, optionId });
  }

  return (
    <div className="app">
      <div className="log" ref={scrollerRef}>
        {items.length === 0 && (
          <div className="hint">Type a message below to start.</div>
        )}
        {items.map((item) => renderItem(item, onPermissionChoice))}
      </div>
      <ChatInput
        ref={inputRef}
        value={input}
        onChange={setInput}
        onSend={onSend}
        onCancel={onCancel}
        onLocalCommand={onLocalCommand}
        busy={busy}
      />
    </div>
  );
}

function renderItem(
  item: Item,
  onPermissionChoice: (requestId: string, optionId: string | null) => void,
): React.ReactElement {
  switch (item.kind) {
    case 'user':
      return (
        <div key={item.id} className="item user">
          <Markdown text={item.text} />
        </div>
      );
    case 'agent':
      return (
        <div key={item.id} className="item agent">
          <Markdown text={item.text} />
        </div>
      );
    case 'thought':
      return (
        <div key={item.id} className="item thought">
          <Markdown text={item.text} />
        </div>
      );
    case 'tool':
      return (
        <div key={item.id} className="item">
          <ToolCard tool={item.tool} />
        </div>
      );
    case 'plan':
      return (
        <div key={item.id} className="item plan">
          <div className="plan-title">Plan</div>
          <ul>
            {item.entries.map((e, i) => (
              <li key={i} data-status={e.status}>
                <span className="plan-status">[{e.status}]</span> {e.content}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'status':
      return (
        <div key={item.id} className="item status">
          {item.text}
        </div>
      );
    case 'stderr':
      return (
        <div key={item.id} className="item stderr">
          [scode] {item.text}
        </div>
      );
    case 'error':
      return (
        <div key={item.id} className="item error">
          [error] {item.text}
        </div>
      );
    case 'done':
      return (
        <div key={item.id} className="item done">
          ({item.text})
        </div>
      );
    case 'permission': {
      const resolved = item.resolvedOptionId !== undefined;
      const chosen = resolved
        ? item.options.find((o) => o.optionId === item.resolvedOptionId)
        : undefined;
      return (
        <div key={item.id} className="item permission">
          <div className="permission-card">
            <div className="permission-title">
              <span className="permission-icon">⚠</span> {item.toolTitle}
            </div>
            {item.toolKind && <div className="permission-kind">{item.toolKind}</div>}
            {!resolved ? (
              <div className="permission-actions">
                {item.options.map((opt) => (
                  <button
                    key={opt.optionId}
                    className={`perm-btn perm-${opt.kind ?? 'default'}`}
                    onClick={() => onPermissionChoice(item.requestId, opt.optionId)}
                  >
                    {opt.name}
                  </button>
                ))}
                <button
                  className="perm-btn perm-cancel"
                  onClick={() => onPermissionChoice(item.requestId, null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="permission-resolved">
                {chosen ? `→ ${chosen.name}` : '→ cancelled'}
              </div>
            )}
          </div>
        </div>
      );
    }
  }
}
