import React from 'react';

interface BashShape {
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  returnCodeInterpretation?: string;
  backgroundTaskId?: string;
}

interface BashInput {
  command?: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

interface Props {
  input: BashInput | null;
  output: BashShape | null;
}

/** Specialised view for scode's internal `bash` tool, whose rawOutput is a JSON-encoded BashCommandOutput. */
export function BashView({ input, output }: Props): React.ReactElement {
  return (
    <div className="bash-view">
      {input?.command && (
        <pre className="bash-cmd"><span className="bash-prompt">$ </span>{input.command}</pre>
      )}
      {input?.description && <div className="bash-desc">{input.description}</div>}
      {output?.stdout && (
        <details open>
          <summary>stdout</summary>
          <pre className="bash-stdout">{output.stdout}</pre>
        </details>
      )}
      {output?.stderr && (
        <details open>
          <summary>stderr</summary>
          <pre className="bash-stderr">{output.stderr}</pre>
        </details>
      )}
      {output?.interrupted && <div className="bash-meta bash-interrupted">interrupted</div>}
      {output?.returnCodeInterpretation && (
        <div className="bash-meta">exit: {output.returnCodeInterpretation}</div>
      )}
      {output?.backgroundTaskId && (
        <div className="bash-meta">background task: {output.backgroundTaskId}</div>
      )}
      {output && !output.stdout && !output.stderr && !output.interrupted && (
        <div className="bash-meta">(no output)</div>
      )}
    </div>
  );
}

export function tryParseBashOutput(raw: unknown): BashShape | null {
  const obj = coerceObject(raw);
  if (!obj) return null;
  if (typeof obj.stdout !== 'string' && typeof obj.stderr !== 'string') return null;
  return {
    stdout: typeof obj.stdout === 'string' ? obj.stdout : undefined,
    stderr: typeof obj.stderr === 'string' ? obj.stderr : undefined,
    interrupted: obj.interrupted === true,
    returnCodeInterpretation:
      typeof obj.returnCodeInterpretation === 'string' ? obj.returnCodeInterpretation : undefined,
    backgroundTaskId: typeof obj.backgroundTaskId === 'string' ? obj.backgroundTaskId : undefined,
  };
}

export function tryParseBashInput(raw: unknown): BashInput | null {
  const obj = coerceObject(raw);
  if (!obj) return null;
  if (typeof obj.command !== 'string') return null;
  return {
    command: obj.command,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    timeout: typeof obj.timeout === 'number' ? obj.timeout : undefined,
    run_in_background: obj.run_in_background === true,
  };
}

function coerceObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}
