import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Extension-host unit tests. The bare `import * as vscode from 'vscode'` only
// resolves inside the VS Code runtime, so we alias it to a local mock — more
// robust than `vi.mock('vscode')`, which can't intercept a module the resolver
// can't even find. Scoped to src/**/*.test.ts so the webview vitest suite
// (run separately via `npm --prefix webview-ui run test`) is untouched.
export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'src/test/vscode-mock.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
