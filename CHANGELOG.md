# Changelog

All notable changes to the Sudocode VS Code extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-27

First public-ready release. Functional Sudocode chat in the sidebar with the major Claude-Code-style features in place.

### Added

- Sidebar chat view powered by the official ACP SDK over `scode acp` stdio.
- Streaming agent messages with Markdown / GFM / fenced code rendering.
- Inline `bash` tool view (command + stdout + stderr, scrollable, exit-code metadata).
- Inline file-tool views for read/write/edit/glob: path display, content preview, basic diff coloring for `edit` results.
- Plan rendering: live checklist of plan entries with status crossed-out on completion.
- Inline tool-permission approval cards (Allow Once / Allow Always / Reject Once / Reject Always / Cancel), color-coded by intent, with resolved-state display.
- Right-click and `Cmd+Alt+L` to send selection or whole file into the chat input with a `path:line-range` header.
- `WorkspaceEdit`-based file writes so the agent's edits are Ctrl+Z-undoable in the editor.
- Slash-command picker (`/clear`, `/restart`, `/help` handled locally; `/compact`, `/cost`, `/model` etc. forwarded to scode).
- Webview state preservation across collapses/reloads via `vscode.getState` / `setState`.
- First-launch detection of missing `scode` binary with a "Install Guide" / "Set CLI Path" notification.
- Translation of common `scode` stderr lines (401/403, ENOENT) into one-line user hints.
- Settings: `sudocode.cliPath`, `sudocode.authMode`, `sudocode.permissionMode`, `sudocode.model`, `sudocode.extraArgs`.
- Defensive reducer behavior for `tool_update` arriving before its `tool` event.
- Unit tests (vitest) for the webview reducer.
- GitHub Actions CI: typecheck + test + build.

### Known issues

- `scode` ships with `danger-full-access` as the default permission mode, so the inline approval flow rarely fires without explicit configuration.
- `scode acp` does not yet expose session resume; the agent process is restarted from scratch on reload.
- Multi-root workspaces use only the first folder as the working directory.
