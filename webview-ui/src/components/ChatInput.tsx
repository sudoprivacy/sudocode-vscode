import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

export interface ChatInputHandle {
  focus(): void;
}

interface Props {
  value: string;
  onChange(text: string): void;
  onSend(text: string): void;
  onCancel(): void;
  onLocalCommand(name: 'clear' | 'help'): void;
  busy: boolean;
}

interface SlashItem {
  name: string;
  hint: string;
  local?: 'clear' | 'help';
}

const SLASH_COMMANDS: SlashItem[] = [
  { name: '/clear', hint: 'Clear chat and restart the scode agent', local: 'clear' },
  { name: '/restart', hint: 'Restart the scode agent (alias of /clear)', local: 'clear' },
  { name: '/help', hint: 'Show Sudocode help', local: 'help' },
  { name: '/compact', hint: 'Compact session context (scode built-in)' },
  { name: '/cost', hint: 'Show session cost (scode built-in)' },
  { name: '/model', hint: 'Switch model (scode built-in)' },
];

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
  { value, onChange, onSend, onCancel, onLocalCommand, busy },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [menuIdx, setMenuIdx] = useState(0);

  useImperativeHandle(ref, () => ({
    focus() {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
    },
  }));

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  const slashQuery = useMemo<string | null>(() => {
    if (!value.startsWith('/')) return null;
    if (/\s/.test(value)) return null;
    return value.slice(1).toLowerCase();
  }, [value]);

  const matches = useMemo<SlashItem[]>(() => {
    if (slashQuery === null) return [];
    return SLASH_COMMANDS.filter((c) => c.name.slice(1).toLowerCase().startsWith(slashQuery));
  }, [slashQuery]);

  useEffect(() => {
    if (menuIdx >= matches.length) setMenuIdx(0);
  }, [matches.length, menuIdx]);

  function pickMatch(item: SlashItem) {
    if (item.local) {
      onChange('');
      onLocalCommand(item.local);
    } else {
      onChange(item.name + ' ');
      requestAnimationFrame(() => taRef.current?.focus());
    }
  }

  function send() {
    const text = value.trim();
    if (!text) return;
    // Exact local command match — handle without sending to agent.
    const local = SLASH_COMMANDS.find((c) => c.name === text && c.local);
    if (local?.local) {
      onChange('');
      onLocalCommand(local.local);
      return;
    }
    onSend(text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenuIdx((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenuIdx((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && value === matches[menuIdx]?.name.slice(0, value.length))) {
        // Tab always autocompletes; Enter only autocompletes when user hasn't typed past the prefix.
        e.preventDefault();
        pickMatch(matches[menuIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onChange('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="input-wrap">
      {matches.length > 0 && (
        <div className="slash-menu" role="listbox">
          {matches.map((m, i) => (
            <div
              key={m.name}
              className={`slash-item${i === menuIdx ? ' active' : ''}`}
              role="option"
              aria-selected={i === menuIdx}
              onMouseDown={(e) => {
                e.preventDefault();
                pickMatch(m);
              }}
              onMouseEnter={() => setMenuIdx(i)}
            >
              <span className="slash-name">{m.name}</span>
              <span className="slash-hint">{m.hint}</span>
            </div>
          ))}
        </div>
      )}
      <div className="input-row">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Sudocode… (Enter to send, Shift+Enter for newline, / for commands)"
          rows={1}
        />
        {busy ? (
          <button onClick={onCancel} className="btn-cancel" title="Cancel current turn">
            Cancel
          </button>
        ) : (
          <button onClick={send} disabled={!value.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
});
