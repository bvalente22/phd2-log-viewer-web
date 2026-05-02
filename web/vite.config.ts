/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Resolve the package.json version and the current git short hash at build
// time and surface them as `__APP_VERSION__` / `__APP_GITHASH__` constants for
// the UI to display. Builds outside a git checkout (or before any commit)
// fall back to "nogit". `execFileSync` is used (no shell) since the args are
// fixed strings and we don't need shell features.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
let gitHash = 'nogit';
try {
  gitHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
} catch {
  // not a git repo, leave fallback
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_GITHASH__: JSON.stringify(gitHash),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**'],
  },
});
