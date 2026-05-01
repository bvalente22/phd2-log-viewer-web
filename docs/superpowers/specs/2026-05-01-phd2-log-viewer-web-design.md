# PHD2 Log Viewer — Web Edition

**Status:** Design approved 2026-05-01
**Source app:** [agalasso/phdlogview](https://github.com/agalasso/phdlogview) (C++/wxWidgets), version 0.6.4
**Target:** Static, fully client-side web app with feature parity, shipped in three waves.

---

## 1. Goal

Reproduce the PHD2 Log Viewer desktop app as a browser-based tool. Users open a PHD2 guide log and get the same insights — section navigation, guide graphs, calibration plots, statistics, exclusion editing, and drift/periodogram analysis — without installing software and without uploading data anywhere.

## 2. Non-goals

- No backend, no accounts, no telemetry, no log sharing.
- No real-time integration with PHD2 (this is a post-session viewer).
- Not a 1:1 visual copy of the wx UI. Modernize layout; keep interactions familiar.

## 3. Scope (phased)

### v1 — Core viewer
- File open via drag-drop and picker.
- IndexedDB recents (LRU, ~10 entries, stores raw log text + filename + size + opened-at).
- Section list (calibration + guiding sections, in source order).
- Main guide graph for a selected guiding section: RA + Dec (or dx/dy) lines, two y-axes (pixels / arc-seconds), pan/zoom, info-event vertical markers.
- Stats grid: RMS Total / RA / Dec, Peak RA / Dec, Drift RA / Dec (px/min and arc-sec/min), polar alignment error, count included/excluded, duration. Click-to-copy per cell.
- Exclusion editing:
  - Ctrl-drag to exclude a range.
  - Right-click menu: Include all / Exclude all / Exclude frames settling.
  - Excluded ranges shown as grey overlays.
  - Stats recompute on mask change.
- Keyboard: `P` / `Z` toggle vertical pan-vs-zoom, `[` / `]` step section, arrow keys nudge view.

### v2 — Parity for static views
- Calibration plot (separate component for `Calibration` sections).
- Scatter plot view (alternate rendering of the same session data).
- Vertical scale lock across sections.
- AO ↔ Mount toggle (when AO data present).
- dx/dy ↔ RA/Dec coordinate toggle.
- Trace visibility toggles: RA, Dec, RA pulses, Dec pulses, mass, SNR.
- INFO event annotations richer (settle/dither categorization on hover).

### v3 — Analysis
- Analysis window: drift-corrected timeline + periodogram (FFT) for Guiding Assistant runs.
- Right-click "Analyze selected frames" / "Analyze selected, raw RA" / "Analyze unguided section" wired to open Analysis.
- "Raw RA" mode: re-add RA correction back into the series before drift-correcting (shows what unguided tracking would have looked like).

## 4. Tech stack

- **Framework:** React 18 + TypeScript + Vite.
- **Charts:** Plotly.js + `react-plotly.js`. `scattergl` traces for the main guide graph. Plotly chosen over uPlot for built-in box-zoom, range slider, PNG export, log axes, and rich hover — all features the desktop app exposes or that we want for analysis.
- **Styling:** Tailwind CSS + Radix UI primitives (headless menus, dialogs, tooltips).
- **State:** Zustand. Two stores — `logStore` (current `GuideLog`, file metadata, selected section index) and `viewStore` (pan/zoom, toggles, exclusion masks per section, recent files index).
- **Storage:** IndexedDB via `idb-keyval`. Stores `{ id, name, size, openedAt, text }` records, max ~10 LRU.
- **Testing:** Vitest (unit + golden snapshots), Playwright (one E2E smoke test).
- **Hosting:** Static build, deployable to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages).
- **Project layout:** New `web/` directory at repo root, alongside the original C++ source.

## 5. Architecture

```
web/
  src/
    parser/                # pure TS, no DOM, no React
      tokens.ts            # PHD2 log line constants
      parseLog.ts          # state machine: SKIP|GUIDING_HDR|GUIDING|CAL_HDR|CALIBRATING -> GuideLog
      parseEntry.ts        # per-line CSV parsing for guide entries
      parseCalibration.ts  # per-line parsing for calibration entries
      parseInfo.ts         # INFO event extraction + coalescing
      fixupMonotonic.ts    # backward-timestamp repair
      stats.ts             # CalcStats: RMS, drift, error ellipse, PAE
      types.ts             # GuideLog, GuideSession, Calibration, GuideEntry, ...
      __tests__/
    storage/
      recents.ts           # idb-keyval wrapper, LRU eviction
    state/
      logStore.ts          # current log, file meta, selected section
      viewStore.ts         # pan/zoom, toggles, exclusion masks
    components/
      App.tsx
      DropZone.tsx
      RecentsPanel.tsx
      SectionList.tsx
      GuideGraph.tsx       # Plotly line graph w/ scattergl
      CalibrationPlot.tsx  # v2
      AnalysisView.tsx     # v3
      StatsGrid.tsx
      InfoMarkers.tsx      # overlay
      ContextMenu.tsx      # Radix-based right-click menu
    pages/
      ViewerPage.tsx       # shell: dropzone | recents | sections | graph+stats
    main.tsx
  samples/                 # small sample PHD2 logs for dev + golden tests
  index.html
  vite.config.ts
  package.json
  tsconfig.json
  playwright.config.ts
```

### Module boundaries

- `parser/` is a pure module. Public surface: `parseLog(text: string): GuideLog`, `calcStats(session: GuideSession, mask?: ExclusionMask): SessionStats`. No imports from React, the DOM, or storage.
- `state/` knows about `parser/` types but not about Plotly or React rendering. It exposes selectors like `getActiveSession()`, `getVisibleEntries()`, `getEffectiveStats()`.
- `components/` are presentational. They read from stores via selectors and render. They do not parse, do not access IndexedDB directly, do not call `fetch`.
- `storage/` is called from `logStore` only.

This split exists so the parser can be unit-tested in isolation against golden fixtures, and so the chart/UI can be rewritten or replaced without touching parsing or stats math.

## 6. Data flow

1. User drops a file (or picks one) → `DropZone` reads it as text (UTF-8).
2. `parser.parseLog(text)` returns a `GuideLog`.
3. `logStore.setLog(log, meta)` stores the parsed log and writes the raw text to IndexedDB recents.
4. `SectionList` renders `log.sections` (a flat ordered list of `{type, idx}` entries pointing into `log.sessions` or `log.calibrations`).
5. Selecting a section updates `viewStore.selectedSectionIndex`.
6. `GuideGraph` reads the active session via selector, builds Plotly traces (each trace gated by a `viewStore` visibility flag), applies pan/zoom and exclusion overlays.
7. User interactions (drag, keys, menu items) dispatch to `viewStore`.
8. `StatsGrid` reads `getEffectiveStats()` which calls `parser.calcStats(session, exclusionMask)`.

## 7. Parser port — critical details

The C++ parser ([logparser.cpp](../../../logparser.cpp)) is a five-state line-by-line state machine. Port verbatim, including these details that are easy to miss:

- **Section ordering:** `log.sections` preserves insertion order across both guiding and calibration sections via `LogSectionLoc{type, idx}`. The TS port uses the same shape.
- **`ParseEntry`:** the original uses a sentinel-comma trick for the optional info column. In TS, use a plain `split(",")` with a default-on-empty handler. The CSV has these columns: `Frame,Time,mount,dx,dy,RARawDistance,DECRawDistance,RAGuideDistance,DECGuideDistance,RADuration,RADirection,DECDuration,DECDirection,XStep,YStep,StarMass,SNR,ErrorCode,Info?`.
- **Direction flips:** `RADuration` is negated when `RADirection == "W"`; `DECDuration` is negated when `DECDirection == "S"`. East/North leave the magnitude positive.
- **AO step columns:** for AO sessions, `XStep`/`YStep` overwrite `radur`/`decdur` after the direction flip. Order matters.
- **`ParseMount`:** parses `xAngle`, `xRate`, `yAngle`, `yRate` from the `Mount = ...` / `AO = ...` header line. Apply the px/ms → px/sec heuristic: if rate < 0.05, multiply by 1000 (older logs).
- **`FixupNonMonotonic`:** if any `dt[i] <= dt[i-1]`, compute the median positive interval, then walk forward replacing each non-positive gap with the median (and accumulating the correction into all subsequent timestamps). Insert a synthetic info event "Timestamp jumped backwards" at each repair point.
- **`ParseInfo` coalescing:**
  - Repeated identical info events on adjacent frames collapse into one with an incremented `repeats` counter.
  - Parameter-change events with the same key (text before `=`) replace the prior event at the same frame index.
  - `DITHER` events that immediately follow a `SET LOCK POS` at the same frame replace the prior event.
  - Strip prefixes `"SETTLING STATE CHANGE, "` and `"Guiding parameter change, "`.
  - Trim DITHER trailing `, new lock pos ...`.
  - Strip trailing zeros after the last `.` (regex `\.[0-9]+?(0+)$`).
- **Dropped frames:** if `!StarWasFound(err)` (err not in {0,1}), set `included = false` and synthesize an info event from `e.info` (or `"Frame dropped"` if absent).
- **Calibration directions:** `West`/`Left` → WEST, `East` → EAST, `Backlash` → BACKLASH, `North`/`Up` → NORTH, `South` → SOUTH. Presence of `Left`/`Up` implies `cal.device = AO`.

### Stats math (port from `LogViewFrame.cpp::CalcStats`)

For a session and an exclusion mask:
- Filter entries where `included && !excluded`.
- RMS RA / Dec: `sqrt(mean(raraw^2))`, `sqrt(mean(decraw^2))`.
- Peak RA / Dec: `max(abs(...))`.
- Mean RA / Dec: arithmetic mean.
- Drift RA / Dec: linear regression slope of `raraw` / `decraw` against `dt`, scaled to per-minute.
- Error ellipse: PCA on `(raraw, decraw)` — `theta`, `lx`, `ly`, `elongation = lx/ly`.
- PAE (polar alignment error): `|drift_dec| * 3.81972 / cos(declination)` arc-min (the desktop formula — verify exact constant when porting).
- Pixel scale conversion: arc-sec value = pixel value × `session.pixelScale`.

## 8. Charting (Plotly specifics)

- Two y-axes: pixels (left, primary), arc-seconds (right, derived). `yaxis2: { overlaying: 'y', side: 'right' }`.
- Traces (each toggleable):
  - RA-error (or dx) — `scattergl`, line.
  - Dec-error (or dy) — `scattergl`, line.
  - RA pulses — `bar` overlay on a third axis, or step line.
  - Dec pulses — same.
  - Mass — secondary scale, optional.
  - SNR — secondary scale, optional.
- Info events: Plotly `shapes` (vertical lines) + `annotations` shown on hover.
- Excluded ranges: low-alpha grey `shape` rectangles over the entire y-range.
- Pan vs Zoom on vertical axis: switch `dragmode` and `yaxis.fixedrange`.
- Vertical scale lock: capture y-range, apply `yaxis.range` on every section change.
- Ctrl-drag exclude: in select mode, capture `plotly_selected` event, push range into `viewStore.exclusions`.
- PNG export: Plotly's built-in modebar.

## 9. Right-click context menu (v1 + v3 wiring)

Built with Radix `ContextMenu`, opened on right-click anywhere over the chart canvas:

| Item | Phase | Action |
|------|-------|--------|
| Include all frames | v1 | Clear exclusion mask for active session |
| Exclude all frames | v1 | Set every entry as excluded |
| Exclude frames settling | v1 | Walk `session.infos` for `SETTLING STATE CHANGE, state=1` → matching `state=0` ranges; mark frames in those ranges excluded |
| ─ separator ─ | | |
| Analyze selected frames | v3 | Open Analysis with included frames |
| Analyze selected, raw RA | v3 | Same, with `addBackRACorrections=true` |
| Analyze unguided section | v3 | Visible only when `session.entries[0].guiding === false`; opens Analysis on the full session |

In v1/v2 the Analyze items are present but disabled with a tooltip "Coming in v3."

## 10. Testing strategy

### Unit (Vitest, in `parser/__tests__/`)
- Per-line cases for `ParseEntry`: full row, missing optional columns, dropped frame, AO step columns, direction flips.
- `ParseInfo`: coalescing rules (repeated events, parameter-change replacement, DITHER-after-SET-LOCK-POS, prefix stripping, trailing-zero stripping).
- `FixupNonMonotonic`: backward jump → median-interval replacement + synthetic info event.
- `ParseCalibration`: each direction, AO vs Mount inference.
- `CalcStats`: hand-computed expected values for a tiny synthetic session.

### Golden (Vitest)
- Commit 3-5 real PHD2 logs in `web/samples/`: small/typical/large, MOUNT-only, AO+Mount, calibration-only.
- For each, commit a JSON snapshot of `{ phdVersion, sectionCount, sessions: [{ entryCount, infoCount, rmsRa, rmsDec, driftRa, driftDec, paeArcMin, ... }], calibrations: [{ entryCount, device }] }`.
- Initial snapshot is generated by running the C++ binary on the same logs and capturing equivalent values — committed as ground truth.
- TS parser must match snapshots within float tolerance (1e-6 absolute or 1e-4 relative).

### E2E (Playwright)
- One smoke test: load page, drop `samples/typical.log`, see section list populated, click first guiding section, see chart canvas mounted, see stats grid filled with non-empty values.

## 11. Performance notes

- PHD2 logs are typically <50 MB; a 30k-entry session is large.
- Plotly with `scattergl` handles 30k points smoothly.
- Parse on the main thread for v1. If profiling shows >500 ms parse on a real log, move into a Web Worker — the parser is already pure, the lift is small.
- Recents store the raw text; on reopen, re-parse rather than caching the parsed structure (parser is fast, structures are large).

## 12. v1 done definition

- Drop a real PHD2 log; it parses without errors.
- Section list shows correct count, dates, and types.
- Selecting a guiding section renders the graph with RA/Dec lines and pan/zoom.
- Stats grid shows numbers matching the C++ desktop app for the same log within float tolerance.
- Exclusion editing (drag, menu items) updates the chart overlay and stats grid live.
- Recents persist across reload.
- One Playwright smoke test passes.

## 13. Out of scope (will not be done)

- Server-side anything.
- Cross-log diffing or trend tracking.
- Editing logs.
- Mobile-first design (responsive is fine; touch-only is not a target).
- Internationalization.

## 14. Risks and open questions

- **Stats parity:** the desktop `CalcStats` lives in [LogViewFrame.cpp](../../../LogViewFrame.cpp); exact constants (PAE conversion factor, ellipse calculation) need to be confirmed during port. Plan: extract by reading the source carefully, validate against C++ output on real logs.
- **AO sessions:** sample logs need to include at least one AO+Mount session to exercise that code path. If we cannot find one, AO support stays untested in v1 and is verified during v2 work.
- **Plotly bundle size:** ~3 MB. Acceptable for a tool app. If it becomes a complaint, evaluate `plotly.js-basic-dist` or lazy-load the chart.
