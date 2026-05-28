import React from 'react';

interface FileToolInput {
  path?: string;
  file_path?: string;
  pattern?: string;
  line?: number;
  limit?: number;
  offset?: number;
  content?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

interface FileToolOutput {
  content?: string;
  files?: string[];
  matches?: unknown[];
  structuredPatch?: unknown;
  diff?: string;
  path?: string;
}

export type FileToolKind = 'read' | 'write' | 'edit' | 'glob' | 'unknown';

export interface ParsedFileTool {
  kind: FileToolKind;
  input: FileToolInput | null;
  output: FileToolOutput | null;
}

function coerceObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asNum(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function parseInput(raw: unknown): FileToolInput | null {
  const obj = coerceObject(raw);
  if (!obj) return null;
  return {
    path: asStr(obj.path),
    file_path: asStr(obj.file_path),
    pattern: asStr(obj.pattern),
    line: asNum(obj.line),
    limit: asNum(obj.limit),
    offset: asNum(obj.offset),
    content: asStr(obj.content),
    old_string: asStr(obj.old_string),
    new_string: asStr(obj.new_string),
    replace_all: obj.replace_all === true,
  };
}

function parseOutput(raw: unknown): FileToolOutput | null {
  const obj = coerceObject(raw);
  if (!obj) return null;
  let files: string[] | undefined;
  if (Array.isArray(obj.files) && obj.files.every((f) => typeof f === 'string')) {
    files = obj.files as string[];
  }
  let matches: unknown[] | undefined;
  if (Array.isArray(obj.matches)) matches = obj.matches;
  return {
    content: asStr(obj.content),
    files,
    matches,
    structuredPatch: obj.structuredPatch,
    diff: asStr(obj.diff),
    path: asStr(obj.path),
  };
}

export function tryParseFileTool(toolKind: string | undefined, title: string | undefined, rawInput: unknown, rawOutput: unknown): ParsedFileTool | null {
  const input = parseInput(rawInput);
  const output = parseOutput(rawOutput);
  if (!input && !output) return null;

  const titleLower = (title ?? '').toLowerCase();
  const hasPath = Boolean(input?.path || input?.file_path || output?.path);
  const hasDiff = Boolean(output?.diff || output?.structuredPatch || input?.old_string);
  const hasFiles = Array.isArray(output?.files);
  const hasPattern = Boolean(input?.pattern);
  const hasContent = typeof input?.content === 'string';

  let kind: FileToolKind = 'unknown';
  if (toolKind === 'edit' || hasDiff) kind = hasContent && !hasDiff ? 'write' : 'edit';
  else if (toolKind === 'search' || hasFiles || hasPattern) kind = 'glob';
  else if (titleLower.includes('write') || hasContent) kind = 'write';
  else if (toolKind === 'read' || titleLower.includes('read')) kind = 'read';
  else if (hasPath) kind = 'read';
  else return null;

  return { kind, input, output };
}

function shortPath(p: string): string {
  // Trim home dir prefix for readability.
  return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

interface Props {
  parsed: ParsedFileTool;
}

export function FileToolView({ parsed }: Props): React.ReactElement {
  const { kind, input, output } = parsed;
  const path = input?.path ?? input?.file_path ?? output?.path;

  if (kind === 'read') {
    return (
      <div className="file-view">
        {path && <div className="file-path">{shortPath(path)}{rangeSuffix(input)}</div>}
        {output?.content !== undefined && (
          <details>
            <summary>content ({lineCount(output.content)} lines)</summary>
            <pre className="file-content">{output.content}</pre>
          </details>
        )}
      </div>
    );
  }

  if (kind === 'write') {
    return (
      <div className="file-view">
        {path && <div className="file-path">{shortPath(path)}</div>}
        {input?.content !== undefined && (
          <details open>
            <summary>write ({lineCount(input.content)} lines)</summary>
            <pre className="file-content">{input.content}</pre>
          </details>
        )}
      </div>
    );
  }

  if (kind === 'edit') {
    return (
      <div className="file-view">
        {path && <div className="file-path">{shortPath(path)}</div>}
        {output?.diff ? (
          <pre className="file-diff">{colorizeDiff(output.diff)}</pre>
        ) : output?.structuredPatch ? (
          <details open>
            <summary>structured patch</summary>
            <pre className="file-content">{JSON.stringify(output.structuredPatch, null, 2)}</pre>
          </details>
        ) : input?.old_string !== undefined ? (
          <div className="file-edit-pair">
            <details open>
              <summary>− old{input.replace_all ? ' (replace all)' : ''}</summary>
              <pre className="file-diff-minus">{input.old_string}</pre>
            </details>
            <details open>
              <summary>+ new</summary>
              <pre className="file-diff-plus">{input.new_string ?? ''}</pre>
            </details>
          </div>
        ) : null}
      </div>
    );
  }

  if (kind === 'glob') {
    const files = output?.files ?? [];
    return (
      <div className="file-view">
        {input?.pattern && <div className="file-path">pattern: <code>{input.pattern}</code></div>}
        {files.length > 0 ? (
          <details open>
            <summary>{files.length} match{files.length === 1 ? '' : 'es'}</summary>
            <ul className="file-list">
              {files.slice(0, 200).map((f, i) => (
                <li key={i}>{shortPath(f)}</li>
              ))}
              {files.length > 200 && <li className="file-list-more">… and {files.length - 200} more</li>}
            </ul>
          </details>
        ) : output ? (
          <div className="file-meta">no matches</div>
        ) : null}
      </div>
    );
  }

  return <div className="file-meta">(unhandled)</div>;
}

function rangeSuffix(input: FileToolInput | null): string {
  if (!input) return '';
  const line = input.line ?? input.offset;
  if (line === undefined) return '';
  const end = input.limit !== undefined ? line + input.limit : undefined;
  return end !== undefined ? `:${line}-${end}` : `:${line}`;
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

function colorizeDiff(diff: string): React.ReactNode {
  return diff.split('\n').map((line, i) => {
    let cls = '';
    if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-plus';
    else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-minus';
    else if (line.startsWith('@@')) cls = 'diff-hunk';
    return (
      <span key={i} className={cls}>
        {line}
        {'\n'}
      </span>
    );
  });
}
