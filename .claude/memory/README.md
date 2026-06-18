# Project memory (portable)

These files mirror cross-session context for this repo so it travels across machines — the per-machine `~/.claude/projects/<hash>/memory/` folder does not sync.

**Source of truth: the `Cross-session context` section at the bottom of [`../../CLAUDE.md`](../../CLAUDE.md).** That section auto-loads in every session. The files here are granular, per-topic copies for inspection and diffing.

- `nas-vitest-toolchain.md` — how to run the JS toolchain (tsc/vitest) when this repo is checked out on the NAS / `G:`-mapped drive, and why `vite.config.ts` needs `preserveSymlinks`.
