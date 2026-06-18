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
  // GitHub Pages serves the site at https://<user>.github.io/<repo>/
  // so all built asset URLs need that sub-path prefix. The trailing
  // slash matters — without it, Vite emits paths that resolve to the
  // org root and 404. Override with VITE_BASE_PATH=/ for root-served
  // hosts (Cloudflare Pages, Netlify, Vercel, NAS at the top of a
  // virtualhost).
  base: process.env.VITE_BASE_PATH ?? '/phd2-log-viewer-web/',
  plugins: [react()],
  // On Windows, a mapped network drive (e.g. G: -> \\\\NAS\\share) is canonicalized
  // back to its UNC target by fs.realpathSync.native, which Vite's resolver uses by
  // default. That turns every resolved module path into a UNC path that vite-node
  // then mangles ("Cannot find module G:\\...\\UGREEN-...\\spy.js"), breaking vitest
  // when the repo lives on a NAS share. preserveSymlinks skips that realpath call so
  // resolved paths stay on the drive letter. Harmless for this project (no symlinked
  // workspace deps).
  resolve: { preserveSymlinks: true },
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
