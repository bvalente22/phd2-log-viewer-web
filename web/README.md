# PHD2 Log Viewer — Web Edition

A browser-based viewer for PHD2 guide logs. Open a log, navigate sections, see
RA/Dec error traces, guide pulses, mass/SNR, and a scatter view with the error
ellipse. Calibration sections render a 2D scatter of step positions. Everything
runs client-side; logs never leave the browser.

This is a TypeScript port of [agalasso/phdlogview](https://github.com/agalasso/phdlogview)
(C++ / wxWidgets desktop app). The parser and stats math are direct ports from
`logparser.cpp` and `LogViewFrame.cpp`; UI was rewritten using React / Plotly.

## Stack

- React 18 + TypeScript + Vite
- Plotly.js for charts (uses scattergl on the time-series view)
- Zustand for state
- Tailwind CSS for styling
- Radix UI for the right-click menu
- IndexedDB (via `idb-keyval`) for the recents list
- Vitest + Playwright for tests

## Getting started

```sh
npm install        # also runs scripts/install-hooks.sh which enables auto-version-bump on commit
npm run dev        # http://localhost:5173, --host so it's reachable on the LAN
npm test           # vitest unit + golden tests
npm run e2e        # Playwright smoke test
npm run build      # production bundle into dist/
```

The build embeds the package.json version and the current git short hash as
compile-time constants (`__APP_VERSION__`, `__APP_GITHASH__`); both are shown
in the app header.

## Versioning

The patch version in `package.json` auto-bumps on every commit via the
`.githooks/pre-commit` hook. Run `scripts/install-hooks.sh` once after cloning
(or just `npm install`, which does it for you) to enable it. The hook skips
itself when:

- A rebase / merge / cherry-pick is in progress.
- `package.json` is already part of the staged diff (you bumped it yourself).

Bump minor/major manually for feature/breaking changes:

```sh
npm version minor --no-git-tag-version
npm version major --no-git-tag-version
```

## Graph interactions

- **Scroll wheel** — zoom X around the cursor.
- **Drag ↕ (no modifier)** — continuous Y zoom; drag up = zoom in, drag down = zoom out, anchored to the data Y under the cursor.
- **Shift + drag ↔** — include selected time range (clears prior exclusions in that span).
- **Ctrl/Cmd + drag ↔** — exclude selected time range.
- **Right-click** — context menu (include / exclude all, exclude dithers/settling, reset section, reset zoom).
- **Recenter Y** button (toolbar) — places y=0 at the chart center without changing zoom.

## Project layout

```
src/
  parser/          # pure-TS port of logparser.cpp + stats.ts (CalcStats)
    __tests__/     # vitest unit, golden, and real-log smoke tests
  storage/         # IndexedDB recents
  state/           # zustand stores: log + view
  components/      # DropZone, SectionList, GuideGraph, ScatterView,
                   # CalibrationPlot, GraphToolbar, ContextMenu, etc.
  pages/           # ViewerPage (the shell)
e2e/               # Playwright smoke spec
samples/           # README only — drop real logs here for golden testing
```

## Comments policy

When porting algorithms from the original C++ source, cite the file and line
range so future readers can cross-check. Same for any place the web port had
to diverge for platform reasons (Plotly quirks, browser APIs, etc.). See
existing examples in `parseLog.ts`, `stats.ts`, `GuideGraph.tsx`.

## License

Same as the upstream PHD2 Log Viewer (GPLv3).
