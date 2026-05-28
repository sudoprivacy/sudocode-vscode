import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCODE_DIR = path.join(os.homedir(), '.nexus', 'sudocode');
const SCODE_CONFIG = path.join(SCODE_DIR, 'sudocode.json');
const SCODE_SETTINGS = path.join(SCODE_DIR, 'settings.json');

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

/** Pull proxy / anthropic credentials out of sudocode.json (mirrors sudowork). */
function readCreds(): { proxy?: { token: string; baseUrl: string }; anthropic?: { apiKey: string; baseUrl: string } } {
  const config = readJson(SCODE_CONFIG);
  const sudorouter = (config as any)?.auth_modes?.proxy?.sudorouter;
  if (sudorouter?.apiKey && sudorouter?.baseUrl) {
    const baseUrl = String(sudorouter.baseUrl).replace(/\/v1\/?$/, '');
    if (baseUrl.includes('sudorouter') || baseUrl.includes('proxy')) {
      return { proxy: { token: sudorouter.apiKey, baseUrl } };
    }
    return { anthropic: { apiKey: sudorouter.apiKey, baseUrl } };
  }
  return {};
}

/**
 * scode reads settings.json on startup and exits(1) if `model` is not present in
 * sudocode.json's models map — which would create a crash/reconnect loop. Correct
 * it to the first available model before spawning.
 */
export function ensureValidScodeModel(): void {
  const settings = readJson(SCODE_SETTINGS);
  const config = readJson(SCODE_CONFIG);
  const models = config.models && typeof config.models === 'object' ? Object.keys(config.models as object) : [];
  const current = typeof settings.model === 'string' ? settings.model : undefined;
  if (current && models.length > 0 && !models.includes(current)) {
    settings.model = models[0];
    mkdirSync(SCODE_DIR, { recursive: true });
    writeFileSync(SCODE_SETTINGS, JSON.stringify(settings, null, 2), 'utf-8');
  }
}

/** Build the environment scode needs to start and authenticate in ACP mode. */
export function buildScodeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // These leak in from the VS Code / npm parent and confuse a child Node-based CLI.
  delete env.NODE_OPTIONS;
  delete env.ANTHROPIC_MODEL;
  delete env.CLAUDECODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('npm_')) delete env[key];
  }

  // scode is a Rust binary and relies on HOME (Windows has no HOME by default).
  if (!env.HOME) env.HOME = os.homedir();
  if (!env.SUDOCODE_CONFIG_PATH) env.SUDOCODE_CONFIG_PATH = SCODE_CONFIG;

  if (!env.PROXY_AUTH_TOKEN && !env.ANTHROPIC_API_KEY) {
    const creds = readCreds();
    if (creds.proxy) {
      env.PROXY_AUTH_TOKEN = creds.proxy.token;
      env.PROXY_BASE_URL = creds.proxy.baseUrl;
    } else if (creds.anthropic) {
      env.ANTHROPIC_API_KEY = creds.anthropic.apiKey;
      env.ANTHROPIC_BASE_URL = creds.anthropic.baseUrl;
    }
  }

  // macOS: borrow the Claude Code subscription token if present.
  if (process.platform === 'darwin' && !env.CLAUDE_CODE_OAUTH_TOKEN) {
    try {
      const raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-a', os.userInfo().username, '-w'], { encoding: 'utf-8', timeout: 3000 }).trim();
      const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
      if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
    } catch {
      // not logged in via Claude Code — scode falls back to other auth.
    }
  }

  return env;
}

/** Whether proxy credentials are available (used to decide --auth proxy). */
export function hasProxyAuth(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.PROXY_AUTH_TOKEN && env.PROXY_BASE_URL);
}

export const SCODE_DEFAULT_PATH = path.join(SCODE_DIR, process.platform === 'win32' ? 'scode.exe' : 'scode');

export function resolveScodePath(configured: string | undefined): string {
  if (configured && configured.trim()) return configured.trim();
  if (existsSync(SCODE_DEFAULT_PATH)) return SCODE_DEFAULT_PATH;
  return process.platform === 'win32' ? 'scode.exe' : 'scode';
}

/**
 * Best-effort verification that `scode` is launchable. Checks the configured
 * absolute path first, falls back to `which`/`where`. Returns null on success
 * or a human-readable explanation on failure.
 */
export function probeScodeAvailability(configured: string | undefined): string | null {
  const trimmed = configured?.trim();
  if (trimmed) {
    if (existsSync(trimmed)) return null;
    return `Configured scode binary not found at: ${trimmed}`;
  }
  if (existsSync(SCODE_DEFAULT_PATH)) return null;
  const probe = process.platform === 'win32' ? ['where', 'scode'] : ['which', 'scode'];
  try {
    execFileSync(probe[0], [probe[1]], { stdio: 'ignore', timeout: 3000 });
    return null;
  } catch {
    return 'scode binary not found. Looked in ~/.nexus/sudocode/scode and your PATH.';
  }
}
