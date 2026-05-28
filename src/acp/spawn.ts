import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { buildScodeEnv, ensureValidScodeModel, hasProxyAuth, resolveScodePath } from './env';

export interface SpawnedScode {
  child: ChildProcessWithoutNullStreams;
  command: string;
  args: string[];
}

export type AuthMode = 'auto' | 'subscription' | 'proxy' | 'api-key';
export type PermissionMode = 'default' | 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Spawn `scode acp` (stdio JSON-RPC). The official ACP SDK handles framing over
 * the child's stdin/stdout, so we only need to wire the pipes.
 */
export function spawnScodeAcp(opts: {
  cliPath?: string;
  cwd: string;
  authMode?: AuthMode;
  permissionMode?: PermissionMode;
  model?: string;
  extraArgs?: string[];
}): SpawnedScode {
  ensureValidScodeModel();

  const env = buildScodeEnv();
  const command = resolveScodePath(opts.cliPath);

  const preArgs: string[] = [];
  const mode = opts.authMode ?? 'auto';
  if (mode !== 'auto') {
    preArgs.push('--auth', mode);
  } else if (hasProxyAuth(env)) {
    // Mirror sudowork: force proxy mode when proxy creds are present.
    preArgs.push('--auth', 'proxy');
  }

  if (opts.permissionMode && opts.permissionMode !== 'default') {
    preArgs.push('--permission-mode', opts.permissionMode);
  }
  if (opts.model && opts.model.trim()) {
    preArgs.push('--model', opts.model.trim());
  }
  if (opts.extraArgs?.length) {
    for (const a of opts.extraArgs) if (a) preArgs.push(a);
  }

  const args = [...preArgs, 'acp'];

  const child = spawn(command, args, {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  }) as ChildProcessWithoutNullStreams;

  return { child, command, args };
}
