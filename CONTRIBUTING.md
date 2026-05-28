# Contributing

Thanks for your interest in Sudocode for VS Code.

## Repo layout

- `src/` — extension host code (TypeScript, Node), bundled by esbuild into `dist/extension.js`.
  - `src/extension.ts` — activation entry point.
  - `src/acp/` — ACP client wiring around the `scode` CLI: spawn, env, session, client.
  - `src/webview/chatViewProvider.ts` — the webview view provider and host-side message routing.
- `webview-ui/` — React + Vite app for the chat sidebar, built to `dist/webview/`.
  - `webview-ui/src/reducer.ts` — pure reducer over `HostMessage` events (unit-tested).
  - `webview-ui/src/components/` — UI building blocks (`ChatInput`, `ToolCard`, `BashView`, `FileToolView`, `Markdown`).

## Quick start

```sh
git clone https://github.com/sudoprivacy/sudocode-vscode
cd sudocode-vscode
npm install              # also installs webview-ui deps via postinstall
npm run build            # builds webview + extension
```

Open the repo in VS Code and press **F5** to launch an Extension Development Host. The sidebar chat lives behind the Sudocode activity-bar icon.

## Day-to-day

- `npm run watch` — runs both the extension and webview Vite builds in watch mode.
- `npm run typecheck` — tsc for both packages.
- `npm test` — vitest for the reducer.
- `npm run build` — production build.

After changing extension host code, reload the EDH window (`Cmd+R`). Webview changes hot-reload when `watch:webview` is running.

## scode dependency

The extension drives the `scode` CLI. To work against a local build, point `sudocode.cliPath` at it, e.g.:

```jsonc
// .vscode/settings.json or your user settings
"sudocode.cliPath": "/path/to/sudocode/rust/target/release/scode"
```

## PRs

- Keep changes focused; prefer small reviewable PRs.
- Update `CHANGELOG.md` under an `## [Unreleased]` heading.
- Add or update tests for reducer-level changes.
- Run `npm run typecheck && npm test && npm run build` before pushing.
