import React, { useState } from 'react';
import type { ToolCall } from '../protocol';
import { BashView, tryParseBashInput, tryParseBashOutput } from './BashView';
import { FileToolView, tryParseFileTool } from './FileToolView';

interface Props {
  tool: ToolCall;
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'var(--vscode-testing-iconPassed, var(--vscode-charts-green))';
    case 'failed':
      return 'var(--vscode-testing-iconFailed, var(--vscode-errorForeground))';
    case 'in_progress':
    case 'pending':
      return 'var(--vscode-charts-orange)';
    default:
      return 'var(--vscode-descriptionForeground)';
  }
}

export function ToolCard({ tool }: Props): React.ReactElement {
  const bashInput = tryParseBashInput(tool.rawInput);
  const bashOutput = tryParseBashOutput(tool.rawOutput);
  const isBash = bashInput !== null || bashOutput !== null;
  const fileParsed = isBash ? null : tryParseFileTool(tool.kind, tool.title, tool.rawInput, tool.rawOutput);
  const hasDetails = tool.rawInput !== undefined || tool.rawOutput !== undefined || tool.content !== undefined;
  // File / bash cards are useful at a glance; open by default. Generic JSON stays collapsed.
  const [open, setOpen] = useState(isBash || fileParsed !== null);

  return (
    <div className="tool-card">
      <div className="tool-header" onClick={() => hasDetails && setOpen(!open)} role="button">
        <span className="tool-chevron">{hasDetails ? (open ? '▾' : '▸') : '·'}</span>
        <span className="tool-title">{tool.title || tool.kind || tool.toolCallId}</span>
        <span className="tool-status" style={{ color: statusColor(tool.status) }}>
          {tool.status}
        </span>
      </div>
      {open && hasDetails && (
        <div className="tool-body">
          {isBash ? (
            <BashView input={bashInput} output={bashOutput} />
          ) : fileParsed ? (
            <FileToolView parsed={fileParsed} />
          ) : (
            <>
              {tool.rawInput !== undefined && (
                <details open>
                  <summary>input</summary>
                  <pre>{stringify(tool.rawInput)}</pre>
                </details>
              )}
              {tool.rawOutput !== undefined && (
                <details open>
                  <summary>output</summary>
                  <pre>{stringify(tool.rawOutput)}</pre>
                </details>
              )}
              {tool.content !== undefined && (
                <details>
                  <summary>content</summary>
                  <pre>{stringify(tool.content)}</pre>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
