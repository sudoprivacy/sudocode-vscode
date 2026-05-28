import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import type * as schema from '@agentclientprotocol/sdk';

interface ManagedTerminal {
  id: string;
  child: ChildProcessWithoutNullStreams;
  vscodeTerm: vscode.Terminal;
  buffer: string;
  truncated: boolean;
  outputByteLimit: number | undefined;
  exitStatus?: { exitCode: number | null; signal: string | null };
  exitPromise: Promise<void>;
  dispose(): void;
}

/**
 * Owns the child processes that the agent runs via the ACP `terminal/*` methods.
 *
 * Every agent-spawned command becomes a VS Code Pseudoterminal so the user can
 * see what's running, follow output live, and inspect/kill it from the Terminal
 * panel. We also keep a byte-bounded buffer so the agent can fetch output via
 * `terminal/output` after the fact.
 */
export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private counter = 0;

  create(params: schema.CreateTerminalRequest): schema.CreateTerminalResponse {
    const id = `t${++this.counter}`;
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const v of params.env ?? []) env[v.name] = v.value;

    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd ?? undefined,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number | void>();
    const cmdLine = [params.command, ...(params.args ?? [])].join(' ');

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open() {
        writeEmitter.fire(`\x1b[2m$ ${cmdLine}\x1b[0m\r\n`);
      },
      close() {
        try {
          child.kill('SIGTERM');
        } catch {
          // already exited
        }
      },
      // The agent owns this terminal — discard user keystrokes.
      handleInput() {},
    };

    const vscodeTerm = vscode.window.createTerminal({
      name: `scode: ${truncate(cmdLine, 48)}`,
      pty,
    });
    vscodeTerm.show(false);

    const managed: ManagedTerminal = {
      id,
      child,
      vscodeTerm,
      buffer: '',
      truncated: false,
      outputByteLimit: params.outputByteLimit ?? undefined,
      exitPromise: new Promise<void>(() => undefined),
      dispose: () => {
        try {
          child.kill('SIGTERM');
        } catch {
          // already exited
        }
        try {
          vscodeTerm.dispose();
        } catch {
          // already disposed
        }
      },
    };

    managed.exitPromise = new Promise<void>((resolve) => {
      child.on('exit', (code, signal) => {
        managed.exitStatus = { exitCode: code, signal };
        writeEmitter.fire(`\r\n\x1b[2m[exit code=${code ?? '-'} signal=${signal ?? '-'}]\x1b[0m\r\n`);
        closeEmitter.fire(code ?? 0);
        resolve();
      });
      child.on('error', (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        writeEmitter.fire(`\r\n\x1b[31m[spawn error] ${msg}\x1b[0m\r\n`);
        if (!managed.exitStatus) {
          managed.exitStatus = { exitCode: 1, signal: null };
          closeEmitter.fire(1);
          resolve();
        }
      });
    });

    const onChunk = (chunk: Buffer): void => {
      const text = chunk.toString('utf-8');
      writeEmitter.fire(text.replace(/\r?\n/g, '\r\n'));
      this.appendBuffer(managed, text);
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);

    this.terminals.set(id, managed);
    return { terminalId: id };
  }

  output(params: schema.TerminalOutputRequest): schema.TerminalOutputResponse {
    const t = this.must(params.terminalId);
    return {
      output: t.buffer,
      truncated: t.truncated,
      exitStatus: t.exitStatus
        ? { exitCode: t.exitStatus.exitCode, signal: t.exitStatus.signal }
        : undefined,
    };
  }

  async waitForExit(params: schema.WaitForTerminalExitRequest): Promise<schema.WaitForTerminalExitResponse> {
    const t = this.must(params.terminalId);
    await t.exitPromise;
    return {
      exitCode: t.exitStatus?.exitCode ?? null,
      signal: t.exitStatus?.signal ?? null,
    };
  }

  kill(params: schema.KillTerminalRequest): schema.KillTerminalResponse {
    const t = this.must(params.terminalId);
    try {
      t.child.kill('SIGTERM');
    } catch {
      // already exited
    }
    return {};
  }

  release(params: schema.ReleaseTerminalRequest): schema.ReleaseTerminalResponse {
    const t = this.terminals.get(params.terminalId);
    if (t) {
      t.dispose();
      this.terminals.delete(params.terminalId);
    }
    return {};
  }

  disposeAll(): void {
    for (const t of this.terminals.values()) t.dispose();
    this.terminals.clear();
  }

  private must(id: string): ManagedTerminal {
    const t = this.terminals.get(id);
    if (!t) throw new Error(`Unknown terminal ${id}`);
    return t;
  }

  private appendBuffer(t: ManagedTerminal, text: string): void {
    if (t.outputByteLimit === undefined) {
      t.buffer += text;
      return;
    }
    const used = Buffer.byteLength(t.buffer, 'utf-8');
    const remaining = t.outputByteLimit - used;
    if (remaining <= 0) {
      t.truncated = true;
      return;
    }
    const bytes = Buffer.byteLength(text, 'utf-8');
    if (bytes <= remaining) {
      t.buffer += text;
    } else {
      // Character-level truncation; may slightly overshoot the byte budget but
      // avoids splitting a multi-byte codepoint mid-sequence.
      t.buffer += text.slice(0, remaining);
      t.truncated = true;
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
