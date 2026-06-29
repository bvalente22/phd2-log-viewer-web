# PHD2 Log Viewer — Web Edition

A browser-based viewer and analyzer for [PHD2](https://openphdguiding.org/) guide
logs. Open a log file and explore RA/Dec error traces, guide pulses, mass/SNR,
calibration runs, periodic-error analysis, polar-alignment estimates, and more —
all entirely in your browser. **Your logs never leave your machine**; everything
is parsed and rendered client-side.

▶ **Live app:** https://bvalente22.github.io/phd2-log-viewer-web/

This is a TypeScript/React port of
[agalasso/phdlogview](https://github.com/agalasso/phdlogview) (the C++ / wxWidgets
desktop tool). The parser and statistics math are direct ports of the original
`logparser.cpp` / `LogViewFrame.cpp`; the UI was rebuilt with React + Plotly.

## What it does

- **Guiding sections** — RA/Dec error traces over time, guide pulses, star
  mass/SNR, and a scatter view with the error ellipse and RMS readouts.
- **Calibration sections** — 2D scatter of the calibration step positions plus a
  pointing-context dashboard (pier side, hour angle, declination, altitude, etc.).
- **Periodic-error analysis** — FFT periodogram and drift charts to find your
  mount's periodic error and worm period, matching the desktop PHDLogView output.
- **Polar-alignment estimate** — per-section and whole-log polar-alignment error
  with a bullseye readout.
- **Estimated imaging impact** — projects guide RMS + seeing into an estimated
  star shape, to gauge how guiding will affect your subs.
- **Annotations & recents** — name your logs, add notes, and re-open recent files.
- **Six languages** — English, Español, Deutsch, Français, Italiano, and 简体中文,
  switchable from the 🌐 picker. (PHD2 jargon — RA, Dec, RMS, SNR, etc. —
  intentionally stays in English everywhere.)

## Using it

1. Open the [live app](https://bvalente22.github.io/phd2-log-viewer-web/) (or run
   it locally — see below).
2. **Drag a PHD2 guide log onto the drop zone**, or click to browse for one.
   These are the `PHD2_GuideLog_*.txt` files PHD2 writes to its log directory.
   You can also drop the matching `PHD2_DebugLog_*.txt` alongside it to enable
   the in-app debug-log viewer.
3. Pick a section from the sidebar to inspect it. Open the **Analysis** panel for
   periodic-error / periodogram tools.

### Chart interactions

- **Scroll wheel** — zoom the X axis around the cursor.
- **Left-drag** — pan X and zoom Y (drag up = zoom in).
- **Right-drag** — pan Y and zoom X.
- **Shift + drag** — include a time range; **Ctrl/Cmd + drag** — exclude one.
- **Right-click** — context menu (include/exclude all, exclude dithers/settling,
  reset section, reset zoom).

## Running it locally

The app lives under [`web/`](web/). You need Node.js (18+).

```sh
cd web
npm install        # install dependencies
npm run dev        # http://localhost:5173
npm run build      # production bundle into web/dist/
npm test           # vitest unit + golden tests
```

The build is a fully static bundle (`web/dist/`), so any static host works
(GitHub Pages, Vercel, Netlify, nginx, …). See [`web/README.md`](web/README.md)
for the full developer guide — stack details, project layout, the translation
workflow, versioning, and deployment options.

## Repository layout

```
web/        the application (React + TypeScript + Vite) — see web/README.md
docs/       design docs, specs, and portable how-tos
LICENSE     GPLv3 (same as upstream PHD2 Log Viewer)
```

## License

GPLv3, the same license as the upstream
[PHD2 Log Viewer](https://github.com/agalasso/phdlogview). See [LICENSE](LICENSE).
