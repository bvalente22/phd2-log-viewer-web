# PHD2 Log Viewer — Web Edition

A browser-based viewer for PHD2 guide logs. Open a log, navigate sections, see
RA/Dec error traces, guide pulses, mass/SNR, and a scatter view with the error
ellipse. Calibration sections render a 2D scatter of step positions. Everything
runs client-side; logs never leave the browser.

The interface is available in **English, Español, Deutsch, Français, Italiano,
and 简体中文** — switch languages from the 🌐 picker in the header.
PHD2 jargon (RA, Dec, RMS, SNR, etc.) intentionally stays in English across
every locale; see [Translations](#translations) below.

This is a TypeScript port of [agalasso/phdlogview](https://github.com/agalasso/phdlogview)
(C++ / wxWidgets desktop app). The parser and stats math are direct ports from
`logparser.cpp` and `LogViewFrame.cpp`; UI was rewritten using React / Plotly.

## Stack

- React 18 + TypeScript + Vite
- Plotly.js for charts (uses scattergl on the time-series view)
- Zustand for state
- Tailwind CSS for styling (logical properties throughout — RTL-ready)
- Radix UI for the right-click menu
- IndexedDB (via `idb-keyval`) for the recents list
- `react-i18next` for translations + `Intl.NumberFormat` for locale-aware decimals
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
                   # CalibrationPlot, GraphToolbar, ContextMenu,
                   # LanguagePicker, etc.
  i18n/            # react-i18next init, format helpers, and per-language
    locales/       # JSON catalogs (one folder per language)
  pages/           # ViewerPage (the shell)
e2e/               # Playwright smoke spec
samples/           # README only — drop real logs here for golden testing
```

## Translations

Six languages ship today: `en`, `es`, `de`, `fr`, `it`, `zh` (Simplified
Chinese). The picker in the header switches in real time and persists your
choice to `localStorage`.

Each language lives in its own folder under
[`src/i18n/locales/`](src/i18n/locales/), with the same set of seven JSON
namespaces (`common`, `toolbar`, `analysis`, `stats`, `sections`, `chart`,
`errors`). To improve a translation, just edit the JSON.

**Conventions** (see [`src/i18n/locales/README.md`](src/i18n/locales/README.md)
for the full guide):

- **PHD2 jargon stays in English** — `RA`, `Dec`, `RMS`, `SNR`, `Mass`, `AO`,
  `dither`, `drift`, `xRate`, `xAngle`, `PAE`, `pixel scale`, `mount`, `frame`,
  `guide star`, `periodogram`, etc. This matches what international
  astrophotography communities actually say. The prose around those terms is
  translated normally.
- **Numbers and dates** are not translated in JSON — `Intl.NumberFormat` and
  `Intl.DateTimeFormat` handle them at runtime, so `0.123` renders as `0,123`
  in French/German automatically.
- **Placeholders** like `{{name}}` must stay verbatim; reposition them inside
  the sentence as your language requires.

**Adding a new language:**

1. Copy `src/i18n/locales/en/` → `src/i18n/locales/<lng>/` and translate.
2. Add the imports + entries in `src/i18n/index.ts` (`SUPPORTED_LANGUAGES` +
   `resources`).

The Tailwind layout already uses logical properties (`ms`/`me`/`text-start`/…)
so adding RTL languages later (Hebrew, Arabic) would be a translation task,
not a refactor.

## Comments policy

When porting algorithms from the original C++ source, cite the file and line
range so future readers can cross-check. Same for any place the web port had
to diverge for platform reasons (Plotly quirks, browser APIs, etc.). See
existing examples in `parseLog.ts`, `stats.ts`, `GuideGraph.tsx`.

## Deploying

The app is a static build (`npm run build` → `dist/`), so any static host works.
Three pre-configured options:

- **Vercel** — connect the GitHub repo on https://vercel.com/, select
  this directory as the root. `vercel.json` handles build command, output
  directory, and SPA-style rewrites.
- **Netlify** — connect on https://app.netlify.com/, point it at this
  directory. `netlify.toml` does the rest.
- **GitHub Pages** — `.github/workflows/deploy-pages.yml` ships a manual
  workflow (`workflow_dispatch` only — never auto-deploys). Enable Pages in
  Settings → Pages, choose "GitHub Actions" as the source, then run the
  workflow from the Actions tab to publish the latest `main`.

For LAN-only or self-hosted use, run `npm run build` and serve `dist/` with any
static file server (Caddy, nginx, an nginx Docker container, etc.).

## License

Same as the upstream PHD2 Log Viewer (GPLv3).
