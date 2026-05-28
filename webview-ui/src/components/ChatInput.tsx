import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { PromptImage } from '../protocol';

export interface ChatInputHandle {
  focus(): void;
}

interface Props {
  value: string;
  onChange(text: string): void;
  onSend(text: string): void;
  onCancel(): void;
  onLocalCommand(name: 'clear' | 'help'): void;
  onMentionQuery(query: string | null): void;
  mentionResults: { query: string; files: string[] } | null;
  images: PromptImage[];
  onAddImages(imgs: PromptImage[]): void;
  onRemoveImage(index: number): void;
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

interface MentionContext {
  query: string;
  start: number; // index of '@'
  end: number; // caret index
}

/** Find the @-mention token the caret currently sits in, if any. */
function getMentionContext(value: string, caret: number): MentionContext | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (/\s/.test(ch)) return null;
    if (ch === '@') {
      const before = i === 0 ? '' : value[i - 1];
      if (i === 0 || /\s/.test(before)) {
        return { query: value.slice(i + 1, caret), start: i, end: caret };
      }
      return null;
    }
    i--;
  }
  return null;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
  { value, onChange, onSend, onCancel, onLocalCommand, onMentionQuery, mentionResults, images, onAddImages, onRemoveImage, busy },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [menuIdx, setMenuIdx] = useState(0);
  const [caret, setCaret] = useState(0);

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

  // --- slash command menu ---
  const slashQuery = useMemo<string | null>(() => {
    if (!value.startsWith('/')) return null;
    if (/\s/.test(value)) return null;
    return value.slice(1).toLowerCase();
  }, [value]);

  const slashMatches = useMemo<SlashItem[]>(() => {
    if (slashQuery === null) return [];
    return SLASH_COMMANDS.filter((c) => c.name.slice(1).toLowerCase().startsWith(slashQuery));
  }, [slashQuery]);

  // --- @-mention menu ---
  const mention = useMemo<MentionContext | null>(() => {
    if (slashQuery !== null) return null;
    return getMentionContext(value, caret);
  }, [value, caret, slashQuery]);

  useEffect(() => {
    onMentionQuery(mention ? mention.query : null);
    // onMentionQuery identity is stable from parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mention?.query, mention === null]);

  const mentionFiles = useMemo<string[]>(() => {
    if (!mention || !mentionResults) return [];
    if (mentionResults.query !== mention.query) return [];
    return mentionResults.files;
  }, [mention, mentionResults]);

  // Unified active menu: slash takes precedence, else mention.
  const menuMode: 'slash' | 'mention' | null =
    slashMatches.length > 0 ? 'slash' : mentionFiles.length > 0 ? 'mention' : null;
  const menuLen = menuMode === 'slash' ? slashMatches.length : menuMode === 'mention' ? mentionFiles.length : 0;

  useEffect(() => {
    if (menuIdx >= menuLen) setMenuIdx(0);
  }, [menuLen, menuIdx]);

  function syncCaret() {
    const ta = taRef.current;
    if (ta) setCaret(ta.selectionStart ?? 0);
  }

  function pickSlash(item: SlashItem) {
    if (item.local) {
      onChange('');
      onLocalCommand(item.local);
    } else {
      onChange(item.name + ' ');
      requestAnimationFrame(() => taRef.current?.focus());
    }
  }

  function pickMention(file: string) {
    if (!mention) return;
    const next = value.slice(0, mention.start) + '@' + file + ' ' + value.slice(mention.end);
    const newCaret = mention.start + 1 + file.length + 1;
    onChange(next);
    onMentionQuery(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(newCaret, newCaret);
        setCaret(newCaret);
      }
    });
  }

  function send() {
    const text = value.trim();
    if (!text && images.length === 0) return;
    const local = SLASH_COMMANDS.find((c) => c.name === text && c.local);
    if (local?.local) {
      onChange('');
      onLocalCommand(local.local);
      return;
    }
    onSend(text);
  }

  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault();
    const imgs = await Promise.all(files.map(fileToPromptImage));
    onAddImages(imgs);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuMode) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenuIdx((i) => (i + 1) % menuLen);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenuIdx((i) => (i - 1 + menuLen) % menuLen);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (menuMode === 'slash') onChange('');
        else onMentionQuery(null);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (menuMode === 'mention') {
          e.preventDefault();
          pickMention(mentionFiles[menuIdx]);
          return;
        }
        // slash: Tab always completes; Enter completes only if not typed past prefix
        if (e.key === 'Tab' || value === slashMatches[menuIdx]?.name.slice(0, value.length)) {
          e.preventDefault();
          pickSlash(slashMatches[menuIdx]);
          return;
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="input-wrap">
      {menuMode === 'slash' && (
        <div className="slash-menu" role="listbox">
          {slashMatches.map((m, i) => (
            <div
              key={m.name}
              className={`slash-item${i === menuIdx ? ' active' : ''}`}
              role="option"
              aria-selected={i === menuIdx}
              onMouseDown={(e) => {
                e.preventDefault();
                pickSlash(m);
              }}
              onMouseEnter={() => setMenuIdx(i)}
            >
              <span className="slash-name">{m.name}</span>
              <span className="slash-hint">{m.hint}</span>
            </div>
          ))}
        </div>
      )}
      {menuMode === 'mention' && (
        <div className="slash-menu" role="listbox">
          {mentionFiles.map((f, i) => (
            <div
              key={f}
              className={`slash-item${i === menuIdx ? ' active' : ''}`}
              role="option"
              aria-selected={i === menuIdx}
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(f);
              }}
              onMouseEnter={() => setMenuIdx(i)}
            >
              <span className="slash-name">@{basename(f)}</span>
              <span className="slash-hint">{f}</span>
            </div>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="image-strip">
          {images.map((img, i) => (
            <div key={i} className="image-thumb">
              <img src={`data:${img.mimeType};base64,${img.data}`} alt={`pasted ${i + 1}`} />
              <button
                className="image-remove"
                title="Remove image"
                onClick={() => onRemoveImage(i)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="input-row">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? 0);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
          onPaste={onPaste}
          placeholder="Ask Sudocode… (Enter to send, Shift+Enter for newline, / for commands, @ for files, paste an image)"
          rows={1}
        />
        {busy ? (
          <button onClick={onCancel} className="btn-cancel" title="Cancel current turn">
            Cancel
          </button>
        ) : (
          <button onClick={send} disabled={!value.trim() && images.length === 0}>
            Send
          </button>
        )}
      </div>
    </div>
  );
});

async function fileToPromptImage(file: File): Promise<PromptImage> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { mimeType: file.type || 'image/png', data: btoa(binary) };
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}
