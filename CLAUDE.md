# CLAUDE.md

Project-specific operating rules for Claude Code in this repository.

## Repository layout

- Single canonical repo: `https://github.com/bvalente22/phd2-log-viewer-web` (set as `origin`).
- One `.git`, one timeline. The previous setup had a separate `web/.git` subclone that drifted into a parallel timeline; that workflow is retired. Do not reintroduce a nested `.git` under `web/`.
- The web app lives under `web/`. After the 2026-05-07 history scrub, the C++ desktop sources, debian packaging, CMake build infra, and 3rdparty MSVC artifacts are no longer in the repo or its history. `sample data/` is intentionally gitignored.

## Git workflow — non-negotiable

1. **Push after every commit.** Each commit lands on a feature branch on `origin` immediately. Never let committed work pile up locally between sessions; un-pushed commits are the failure mode that produced the parallel-timeline divergence in the past.
2. **`main` only advances via PR merge.** Never push directly to `main`. Force-push to `main` is reserved for explicitly-authorized one-time history resets and must be requested by name (not by a generic "yes proceed").
3. **No history rewrites — ever.** No `git filter-repo`, no `filter-branch`, no `rebase --root`, no `amend` after push, no fresh-init-and-replay. Path/structure reorganizations become normal commits, not rewrites of earlier history. Rewriting history was the root cause of the prior divergence.
4. **Verify connectivity before opening a PR.** Run `git merge-base --is-ancestor origin/main HEAD` (or `git fetch origin && git log --oneline origin/main..HEAD`) first. If the branch and `origin/main` share no recent ancestor, **stop** and surface the divergence to the user instead of pushing.

## PR workflow

```
git checkout -b <branch-name>           # always work on a feature branch
# ... edits + commits ...
git push -u origin <branch-name>
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "..." --body "..."
# verify locally:
cd web && npx tsc --noEmit && npx vitest run
# if clean, auto-merge per the policy below:
gh pr merge <num> --squash --delete-branch
git checkout main && git pull --ff-only
# restart dev server if it was running, so the merged change is on screen
```

## Auto-merge policy

Claude is the author *and* the only reviewer of every PR in this repo, so requiring explicit per-PR authorization to merge would just make the user a bottleneck. The standing policy is:

- **Coding PRs** — UI changes, refactors, perf work, bug fixes, tests, i18n strings, comments, docs *inside* the web app. Auto-merge as soon as `tsc --noEmit` + `vitest run` are clean. After merge: `git pull --ff-only` on `main`, restart the dev server if it was running, confirm the merged state.
- **Non-coding PRs that need user eyes** — license / copyright changes, security policy, dependency upgrades, infrastructure / CI / hooks, anything that deletes data, anything that touches `CLAUDE.md` or memory files. **Do NOT auto-merge.** Open the PR, surface the diff, wait.
- **Rule changes** (force-push, history rewrites, deletes on protected branches) — still need the per-action authorization called out below. The auto-merge policy does not loosen those.

If a PR sits at the boundary between coding and policy ("this also bumps a dep" / "this rewrites a generated file") — surface it, don't auto-merge.

## Things to never do without explicit user authorization

- `git push --force` / `git push --force-with-lease` to `main`
- `git push origin --delete main`
- Anything in the "no history rewrites" list above
- Deleting branches that have unmerged commits the user may want
- Merging a PR that touches `CLAUDE.md`, memory files, or licensing

## Cross-session context

### Toolchain on the NAS / `G:`-mapped checkout (machine-specific)

This repo is often checked out on a NAS SMB share (`\\UGREEN-DXP6800P\PROJECTS`, also mapped to drive **`G:`**). When it is:

- **Run `tsc`/`vitest` from the `G:` drive via `node` — not `npx`, and not from the UNC path.** E.g. `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/vitest/vitest.mjs run [files]` and `… && node node_modules/typescript/bin/tsc --noEmit`. From the UNC path, `vite-node` builds an invalid regex (it assumes `process.cwd()[0]` is a drive letter) and `cmd`/`npx` reject a UNC working directory; even from `G:`, Windows native realpath canonicalizes the mapped drive back to its UNC target and `vite-node` mangles the module path. The Bash tool's cwd resets to the UNC primary dir between calls, so include the `cd /g/...` every time. File edits and `git` work fine from the UNC path — only the Vite/vitest toolchain needs `G:`.
- `web/vite.config.ts` sets `resolve: { preserveSymlinks: true }` specifically to fix this (it skips the realpath call). It is a **no-op for the production build** (no symlinked workspace deps).
- Git auto-maintenance can't write packs on the share (`geometric-repack` permission denied) — keep `gc.auto=0`, `maintenance.auto=false`, `fetch.writeCommitGraph=false` in `.git/config`, and add `safe.directory` entries for **both** the UNC and `G:` path forms.
- On a normal local clone none of this applies and `preserveSymlinks` is a harmless no-op.

More detail mirrored in `.claude/memory/nas-vitest-toolchain.md`.

### UI conventions — tooltips

Keep native `title` tooltips **narrow** — wrapped to ~44 chars/line (narrow-and-tall), matching the Image Impact ("estimated imaging impact" ellipse) tooltips. Run tooltip text through the shared `wrapTip(text, max=44)` helper in `web/src/i18n/format.ts` (extracted from ImageImpact's former private `wrap`). Wide single-line tooltips (e.g. the polar-alignment bullseye / "!" tooltips) are too wide — wrap them. Applies to new and existing tooltips, now and going forward. More in `.claude/memory/ui-tooltips.md`.

### Polar alignment — status & open follow-ups

The polar-alignment **accuracy phase** (effective mean hour angle for the per-section Alt/Az split; whole-log least-squares "All Sections" solve with High/Medium/Low/— confidence; one toggling Section⟷All-Sections area (now the Polar Alignment tab — see *Guiding stats footer* below); narrow `wrapTip` tooltips) is complete and merged to `main` (PR #109, `945acf6`). Developer explainer: `docs/polar-alignment-explained.md`; spec + plan under `docs/superpowers/`. Prior phases: the per-section Polar Alignment Error feature; the desktop-default settling policy (#106).

Open follow-ups (non-blocking): (1) optional — add a residual-driven Low/Medium confidence test to `web/src/parser/__tests__/globalPolarAlignment.test.ts` (the final review's one recommendation); (2) the user wants a short-email summary of the PA approach for another developer — a draft was provided in chat, pending a decision on shortening it and/or adding it as an abstract to the explainer doc. More in `.claude/memory/pa-accuracy-status.md`.

### Guiding stats footer — tabbed (`StatsTabs`)

The guiding-section footer band (under the chart) is a **three-tab strip** — `web/src/components/StatsTabs.tsx`, mirroring `CalibrationTabs`: **Stats** (default) | **Estimated Imaging Impact** | **Polar Alignment**. Only the active panel renders; tab state is component-local and resets to Stats on each section switch.

- `StatsGrid` is now **stats-only** (Total / RA / Dec rows + included/excluded counts). The PA readout + bullseye + whole-log "All Sections" solve were extracted into `PolarAlignmentPanel`. `ImageImpact` is unchanged except its header.
- **The All-Sections PA confidence (High/Medium/Low) is computed but intentionally NOT shown in the UI** — the All-Sections line shows only the section count. The confidence still gates whether the solve resolves (insufficient → "—"), so don't treat its absence as a bug.
- The Imaging Impact and Polar Alignment tab headers carry an **"EXPERIMENTAL"** suffix by design ("Estimated Imaging Impact: EXPERIMENTAL", "Polar Alignment Error: EXPERIMENTAL").
- Shipped in PR #113 (squash `339570a`). Spec: `docs/superpowers/specs/2026-06-19-tabbed-stats-footer-design.md`. More in `.claude/memory/tabbed-stats-footer.md`.

### Analysis charts — gestures & view persistence

Chart pan/zoom is custom, not Plotly's built-in drag. The shared hook `web/src/components/useChartGestures.ts` (Plotly `dragmode:false`) maps **left-drag = pan X + zoom Y** (center-anchored), **right-drag = pan Y + zoom X**, shift/ctrl-drag = include/exclude range; scroll-zoom is Plotly's built-in.

- **Each chart persists its own view in a store** or hover/drag re-renders snap the range back to the data default: drift chart `driftXRangeView` + `driftYRangeView` (Y added #117) in `analysisStore`; periodogram `periodXRangeViewLog` + `yMaxViewPx`; GuideGraph `sectionViews`. The component feeds the stored view into `layout.{x,y}axis.range` each render.
- **Gotcha:** `yaxis.fixedrange:true` does NOT block programmatic `Plotly.relayout` of the range — it only disables user scroll/drag zoom on that axis. Charts keep it `true` to constrain *scroll* to X while the custom handler still drag-zooms Y. The drift-chart Y-zoom was broken (#117) only because Y wasn't persisted, not because of fixedrange.
- **Decision:** the drift chart X/Y view (like the periodogram) persists across the Raw RA / Residual / Manual Spike mode swaps **and** px↔arcsec scale flips — NOT auto-reset on scale flip (`setScaleMode` resets nothing). Resets only on modal (re)open. A drift-chart "Reset Y" affordance was deliberately left out (the "Reset Y" button is periodogram-only). More in `.claude/memory/analysis-chart-gestures.md`.

### CI / Pages deploy — Node 24 status

`.github/workflows/deploy-pages.yml` deploys on **every push to `main`** (`npm ci && npm run build` → `web/dist` → Pages; no path filter, so docs/memory merges deploy too). Live: https://bvalente22.github.io/phd2-log-viewer-web/.

- **Node 20 deprecation (handled in #115):** bumped `actions/checkout@v4→v5`, `actions/setup-node@v4→v5`, build `node-version 20→22`. **Still Node 20, no fix yet:** `actions/upload-pages-artifact@v3` (→ `upload-artifact@v4`) and `actions/deploy-pages@v4` — GitHub hasn't shipped Node 24 versions of the Pages actions, so those two "Node 20 deprecated" warnings are **expected**; deploys stay green (runner force-runs them on Node 24). Bump once available, before the **Sept 16 2026** Node-20 removal.
- **Auth gotcha:** pushing under `.github/workflows/` needs the `gh` token's **`workflow`** scope (plain `repo` is rejected). Granted on this machine via `gh auth refresh -h github.com -s workflow` — run it in an **interactive terminal** (the device-code flow doesn't complete headless). More in `.claude/memory/ci-pages-deploy.md`.
