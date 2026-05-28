import React, { useState } from 'react';
import type { AskAnswer, AskQuestion } from '../protocol';

interface Props {
  questions: AskQuestion[];
  resolved: boolean;
  onSubmit(answers: AskAnswer[]): void;
  onCancel(): void;
}

const CUSTOM = '__custom__';

function questionKind(q: AskQuestion): 'single_select' | 'multi_select' | 'text' | 'boolean' {
  if (q.kind) return q.kind;
  return Array.isArray(q.options) && q.options.length > 0 ? 'single_select' : 'text';
}

/** Inline card for scode's _scode/ask_user_question — radio/checkbox/text/boolean + optional custom input. */
export function QuestionCard({ questions, resolved, onSubmit, onCancel }: Props): React.ReactElement {
  // Per-question state, keyed by question id.
  const [single, setSingle] = useState<Record<string, string>>({});
  const [multi, setMulti] = useState<Record<string, Set<string>>>({});
  const [text, setText] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});

  function toggleMulti(qid: string, value: string) {
    setMulti((prev) => {
      const next = new Set(prev[qid] ?? []);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [qid]: next };
    });
  }

  function resolveValue(q: AskQuestion): AskAnswer | null {
    const kind = questionKind(q);
    if (kind === 'text') {
      const v = (text[q.id] ?? '').trim();
      if (!v) return q.required ? null : { id: q.id, value: '' };
      return { id: q.id, value: v };
    }
    if (kind === 'boolean') {
      const v = single[q.id];
      if (v === undefined) return q.required ? null : null;
      return { id: q.id, value: v };
    }
    if (kind === 'multi_select') {
      const picked = [...(multi[q.id] ?? [])];
      const customVal = picked.includes(CUSTOM) ? (custom[q.id] ?? '').trim() : '';
      const values = picked.filter((p) => p !== CUSTOM);
      if (customVal) values.push(customVal);
      if (values.length === 0) return q.required ? null : { id: q.id, value: '' };
      return { id: q.id, value: values.join(',') };
    }
    // single_select
    const sel = single[q.id];
    if (sel === undefined) return q.required ? null : null;
    if (sel === CUSTOM) {
      const v = (custom[q.id] ?? '').trim();
      if (!v) return q.required ? null : null;
      return { id: q.id, value: v };
    }
    const opt = q.options?.find((o) => o.value === sel);
    return { id: q.id, value: sel, label: opt?.label };
  }

  function submit() {
    const answers: AskAnswer[] = [];
    for (const q of questions) {
      const a = resolveValue(q);
      if (a) answers.push(a);
    }
    onSubmit(answers);
  }

  const canSubmit = questions.every((q) => {
    if (!q.required) return true;
    return resolveValue(q) !== null;
  });

  return (
    <div className="question-card">
      {questions.map((q) => {
        const kind = questionKind(q);
        const allowCustom = q.allowCustomInput;
        return (
          <div key={q.id} className="question-block">
            <div className="question-prompt">{q.prompt}</div>

            {kind === 'text' && (
              <input
                className="question-text"
                type="text"
                disabled={resolved}
                placeholder={q.customInputHint}
                value={text[q.id] ?? ''}
                onChange={(e) => setText((p) => ({ ...p, [q.id]: e.target.value }))}
              />
            )}

            {kind === 'boolean' && (
              <div className="question-options">
                {[
                  { v: 'true', l: 'Yes' },
                  { v: 'false', l: 'No' },
                ].map((o) => (
                  <label key={o.v} className="question-opt">
                    <input
                      type="radio"
                      name={q.id}
                      disabled={resolved}
                      checked={single[q.id] === o.v}
                      onChange={() => setSingle((p) => ({ ...p, [q.id]: o.v }))}
                    />
                    <span>{o.l}</span>
                  </label>
                ))}
              </div>
            )}

            {(kind === 'single_select' || kind === 'multi_select') && (
              <div className="question-options">
                {q.options?.map((o) => {
                  const checked =
                    kind === 'multi_select'
                      ? (multi[q.id]?.has(o.value) ?? false)
                      : single[q.id] === o.value;
                  return (
                    <label key={o.value} className="question-opt">
                      <input
                        type={kind === 'multi_select' ? 'checkbox' : 'radio'}
                        name={q.id}
                        disabled={resolved}
                        checked={checked}
                        onChange={() =>
                          kind === 'multi_select'
                            ? toggleMulti(q.id, o.value)
                            : setSingle((p) => ({ ...p, [q.id]: o.value }))
                        }
                      />
                      <span className="question-opt-label">
                        {o.recommended && <span className="question-star">★</span>} {o.label}
                        {o.description && <span className="question-opt-desc"> — {o.description}</span>}
                      </span>
                    </label>
                  );
                })}
                {allowCustom && (
                  <label className="question-opt">
                    <input
                      type={kind === 'multi_select' ? 'checkbox' : 'radio'}
                      name={q.id}
                      disabled={resolved}
                      checked={
                        kind === 'multi_select'
                          ? (multi[q.id]?.has(CUSTOM) ?? false)
                          : single[q.id] === CUSTOM
                      }
                      onChange={() =>
                        kind === 'multi_select'
                          ? toggleMulti(q.id, CUSTOM)
                          : setSingle((p) => ({ ...p, [q.id]: CUSTOM }))
                      }
                    />
                    <span>Custom…</span>
                  </label>
                )}
                {allowCustom &&
                  (kind === 'multi_select'
                    ? (multi[q.id]?.has(CUSTOM) ?? false)
                    : single[q.id] === CUSTOM) && (
                    <input
                      className="question-text"
                      type="text"
                      disabled={resolved}
                      placeholder={q.customInputHint ?? 'Type a custom answer'}
                      value={custom[q.id] ?? ''}
                      onChange={(e) => setCustom((p) => ({ ...p, [q.id]: e.target.value }))}
                    />
                  )}
              </div>
            )}
          </div>
        );
      })}

      {!resolved ? (
        <div className="question-actions">
          <button className="perm-btn perm-allow_once" disabled={!canSubmit} onClick={submit}>
            Submit
          </button>
          <button className="perm-btn perm-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="permission-resolved">→ answered</div>
      )}
    </div>
  );
}
