# Sudocode for VS Code

Sudocode brings the [`scode`](https://sudocode.dev) AI coding agent into VS Code's sidebar. It talks to the `scode` CLI over the [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol) so you get streaming chat, tool execution, plan tracking, and inline permission approvals without leaving your editor.

## Features

- **Streaming chat** in the activity-bar sidebar, with Markdown, code blocks, and thought-stream rendering.
- **Tool calls rendered inline** — specialized views for `bash` (command + stdout/stderr), file reads/writes, edits (with diff), and glob searches; everything else falls back to a generic JSON viewer.
- **Plans** rendered as a live checklist that updates as the agent makes progress.
- **Send selection / file to chat** via right-click or `Cmd+Alt+L` (`Ctrl+Alt+L` on Linux/Windows). Snippets land in the input with file path + line range header so the agent has full context.
- **Inline tool-permission approval cards** when `scode` runs in `workspace-write` or `read-only` mode. Choose Allow Once / Allow Always / Reject Once / Reject Always without leaving the chat.
- **Slash commands**: `/` opens a picker. `/clear` resets the session, `/help` shows help, `/compact`/`/cost`/`/model` etc. are forwarded to `scode`.
- **Webview state preservation** across panel reloads — your chat history sticks around even after collapsing the sidebar (note: the agent process is reset, so the model itself does not remember the prior conversation).
- **Friendly first-launch errors** — pops a notification if the `scode` binary can't be found, with a one-click jump to the install guide or the path setting.

## Requirements

- VS Code `>= 1.90`.
- The [`scode`](https://sudocode.dev/install) CLI installed. The extension looks in `~/.nexus/sudocode/scode`, then on `PATH`, and finally at the path you configure under `sudocode.cliPath`.
- A working auth method for `scode`: a Sudo Code subscription, `PROXY_AUTH_TOKEN` + `PROXY_BASE_URL`, an `ANTHROPIC_API_KEY`, or a Claude Code subscription (macOS, auto-detected from keychain).

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `sudocode.cliPath` | _(empty)_ | Override the path to the `scode` binary. |
| `sudocode.authMode` | `auto` | Force `--auth subscription` / `proxy` / `api-key`, or let `scode`/env decide. |
| `sudocode.permissionMode` | `default` | `read-only`, `workspace-write`, `danger-full-access`, or `default` (leaves it unset — `scode` currently defaults to `danger-full-access`). |
| `sudocode.model` | _(empty)_ | Override the model, e.g. `opus`, `sonnet`, `anthropic/claude-opus-4-6`. |
| `sudocode.extraArgs` | `[]` | Extra CLI flags appended before `acp` (e.g. `["--reasoning-effort", "high"]`). |

Changes take effect when you restart the agent — run `Sudocode: Restart Agent` from the command palette or send `/clear`.

## Commands

| Command | Default Keybinding | Notes |
| --- | --- | --- |
| `Sudocode: Send Selection to Chat` | `Cmd+Alt+L` / `Ctrl+Alt+L` | Sends the current editor selection (or whole file if no selection) into the chat input. |
| `Sudocode: Send File to Chat` | — | Sends the current file. |
| `Sudocode: Restart Agent` | — | Kills the `scode` process, clears chat history, and starts fresh. |

## Known limitations

- `scode` defaults to `danger-full-access` mode, so the inline approval cards rarely trigger out of the box. Change `sudocode.permissionMode` to `workspace-write` to see them.
- `scode acp` does not yet support session resume, so the agent does not remember prior conversations after a restart.
- Multi-root workspaces fall back to the first folder as the agent's working directory; per-folder sessions are not yet implemented.
- The bundled `scode` bash tool currently runs commands inside the CLI process rather than through ACP's `terminal/*` methods, so command output is rendered from the tool result rather than a VS Code terminal.

## License

ISC.
