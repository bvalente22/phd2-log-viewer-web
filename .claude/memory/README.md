# Project memory (portable)

These files mirror cross-session context for this repo so it travels across machines — the per-machine `~/.claude/projects/<hash>/memory/` folder does not sync.

**Source of truth: the `Cross-session context` section at the bottom of [`../../CLAUDE.md`](../../CLAUDE.md).** That section auto-loads in every session. The files here are granular, per-topic copies for inspection and diffing.

- `nas-vitest-toolchain.md` — how to run the JS toolchain (tsc/vitest) when this repo is checked out on the NAS / `G:`-mapped drive, and why `vite.config.ts` needs `preserveSymlinks`.
- `ui-tooltips.md` — keep native `title` tooltips narrow-and-tall via the shared `wrapTip` helper.
- `pa-accuracy-status.md` — polar-alignment accuracy phase status + open follow-ups.
- `tabbed-stats-footer.md` — the guiding footer is a 3-tab strip; the All-Sections PA confidence is computed but hidden from the UI.
- `analysis-chart-gestures.md` — custom chart drag pan/zoom, per-chart view persistence, the `fixedrange:true` relayout gotcha, and the drift-chart Y-zoom/persistence decision.
- `ci-pages-deploy.md` — Pages deploy on push to main; the Node 24 action-bump status; pushing workflow files needs the gh `workflow` scope.
