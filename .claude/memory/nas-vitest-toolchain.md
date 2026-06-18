# NAS / vitest toolchain

This repo (`phd2-log-viewer-web`) is often checked out on a **NAS SMB share**: `\\UGREEN-DXP6800P\PROJECTS`. The session's primary working dir is then the UNC path `\\UGREEN-DXP6800P\Projects\HomeLab-Repos\PHDLogViewer`; the same share is mapped to drive **G:**.

**Run the JS toolchain (tsc / vitest) from the G: drive via `node` directly — never `npx`, never from the UNC path:**

```
cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit
cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/vitest/vitest.mjs run [files]
```

The Bash tool's cwd resets to the UNC primary dir after every call, so include `cd /g/...` in **every** toolchain command. Cold vitest ≈ 30s (jsdom env); full suite ≈ 150s. File edits and `git` work fine from the UNC path; only the Vite/vitest toolchain needs G:.

**Why** (three layered failures, all fixed/worked around):

1. From the UNC path, `vite-node` builds an invalid regex (it assumes `process.cwd()[0]` is a drive letter; a UNC cwd's first char is `\`). Separately, `cmd.exe`/`npx` reject a UNC working directory outright.
2. Even from `G:`, Windows native realpath (`fs.realpathSync.native`, which Vite's resolver uses) canonicalizes the mapped drive back to its UNC target, which vite-node mangles → `Cannot find module G:\...\UGREEN-...\spy.js`.
3. **Fix (committed in `web/vite.config.ts`):** `resolve: { preserveSymlinks: true }` skips that realpath call. No-op for the production build (no symlinked workspace deps). On a normal local clone, none of this applies.

**Git on the share:** auto-maintenance (`geometric-repack` / multi-pack-index) hits "permission denied" writing packs and once corrupted a checkout mid-merge. Mitigated by per-repo config in `.git/config`: `gc.auto=0`, `maintenance.auto=false`, `fetch.writeCommitGraph=false`. Git also needs `safe.directory` entries for **both** the UNC and the `G:` path forms.

Surfaced while running the test suite for the polar-alignment feature (spec: `docs/superpowers/specs/2026-06-17-polar-alignment-design.md`).
