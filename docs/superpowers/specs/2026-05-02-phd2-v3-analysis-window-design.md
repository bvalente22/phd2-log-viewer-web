# PHD2 Log Viewer Web — v3 Analysis Window

**Status:** Design approved 2026-05-02
**Source app:** [agalasso/phdlogview](https://github.com/agalasso/phdlogview), `AnalysisWin.cpp` / `AnalysisWin.h`
**Predecessors:** [v1 design](2026-05-01-phd2-log-viewer-web-design.md), the v2 polish work shipped through `v0.2.14`.

---

## 1. Goal

Wire up the three currently-disabled "Analyze..." right-click menu items to a modal **Analysis** view containing a **drift-corrected RA/Dec timeline** and a **periodogram (FFT amplitude vs. period)**, matching the math of the desktop's `AnalysisWin` and the periodic-error readouts users rely on for diagnosing mount issues.

## 2. Non-goals (explicitly deferred)

- Click-position-aware unguided-window selection. v3 picks the **first** contiguous `guiding=false` run in the session; if a log has multiple unguided windows we'll add a stepper later.
- Saving / exporting analysis results. The modal is ephemeral; CSV/PNG export of the analysis charts is a follow-up.
- Live-resync against the main viewer's exclusion mask while the modal is open. Re-analysis only happens on each menu invocation.
- Bit-exact parity with desktop's amplitude/period numbers. The math is the same algorithm, but rounding through different libraries can produce sub-percent differences. We'll assert visual agreement and known-sinusoid recovery, not byte equality.

## 3. Three entry points

The right-click context-menu items, defined today in [`web/src/components/ContextMenu.tsx`](../../../web/src/components/ContextMenu.tsx), gain real handlers:

| Menu item | Range | `undoRaCorrections` | Enabled when |
|---|---|---|---|
| Analyze selected frames | every entry where `included && !excludedByUser` | `false` | `canAnalyze(session, mask)` |
| Analyze selected, raw RA | same as above | `true` | same |
| Analyze unguided section | the first contiguous `guiding=false` run | `false` | session has any `guiding=false` entries |

**Mask honoring (matches desktop):** the desktop's `Include(e) = e.included && StarWasFound(e.err)` predicate works because the desktop's right-click actions mutate `e.included` directly. Our app keeps user exclusions in a separate `Uint8Array` mask. Analysis must combine both: a frame is in-range only when `e.included && StarWasFound(e.err) && mask[i] !== 1`. Same effective behavior as the desktop, separated by source.

## 4. Architecture

```
web/
  src/
    parser/
      analyze.ts          # NEW. Pure TS port of GARun::Analyze + CanAnalyze.
      fft.ts              # NEW. Thin wrapper over fft.js (real-input forward FFT).
      spline.ts           # NEW. Cubic spline (~50 lines, hand-rolled).
      __tests__/
        analyze.test.ts   # NEW.
        spline.test.ts    # NEW.
        fft.test.ts       # NEW.
        analyze.golden.test.ts  # NEW. Snapshot against synthetic.log.
    state/
      analysisStore.ts    # NEW. Zustand: { state: 'closed' | OpenAnalysis,
                          #                  open(opts), close() }.
    components/
      AnalysisModal.tsx   # NEW. Full-screen overlay with toolbar + 2 charts.
      DriftChart.tsx      # NEW. Plotly line plot, drift-corrected RA/Dec.
      PeriodogramChart.tsx # NEW. Plotly line plot, period vs amplitude,
                          # with peak-snap cursor and PE/RMS readout.
      ContextMenu.tsx     # MODIFIED. Three Analyze items now actually fire
                          # analysisStore.open(...).
      ViewerPage.tsx      # MODIFIED. Mounts <AnalysisModal/> at the page root
                          # so it overlays everything.
```

**Boundaries:**

- `parser/analyze.ts` is pure (no React, no DOM, no stores). It takes a `GuideSession`, optional mask, and options; returns a `GARun`. Same testing contract as the existing `parseLog`/`calcStats` modules.
- `analysisStore` is the only thing aware of modal open/closed state. The modal mounts unconditionally; it renders nothing when state is `closed`.
- The two chart components are presentational — they consume a `GARun` and the global `scaleMode`. They don't reach into `logStore` or `analysisStore`.

## 5. Math (port from `AnalysisWin.cpp:283-411`)

`parser/analyze.ts` exposes:

```ts
export interface GARun {
  starts: number | null;          // session.startsMs, for wall-clock readouts
  pixelScale: number;
  range: { begin: number; end: number };  // entry indices
  undoRaCorrections: boolean;
  driftRa: number;                // px/s slope from the linear fit
  driftDec: number;
  t: Float64Array;                // length len
  rac: Float64Array;              // drift-corrected RA position
  decc: Float64Array;             // drift-corrected Dec
  fftPeriod: Float64Array;        // length nfft, ascending
  fftAmplitude: Float64Array;     // pixels
  fftAmpMax: number;              // for axis scaling
  fftSpline: Spline;              // for cursor snap and smooth draw
}

export type AnalyzeOptions = {
  range: { begin: number; end: number };
  undoRaCorrections: boolean;
  mask?: Uint8Array;
};

export function canAnalyze(s: GuideSession, opts: AnalyzeOptions): boolean;
export function analyze(s: GuideSession, opts: AnalyzeOptions): GARun;
export function findUnguidedWindow(s: GuideSession): { begin: number; end: number } | null;
```

Algorithm (citations to the C++ source):

1. **Filter** entries to `included && StarWasFound(err) && !mask[i]`. Need ≥12 (matches the desktop's `MIN_ENTRIES = 12` from `AnalysisWin.cpp:273`, required for the `n/2 - 1 ≥ 5` FFT output spline).
2. **Build accumulated RA position** ([AnalysisWin.cpp:319-338](../../../AnalysisWin.cpp#L319-L338)):
   ```
   move = raraw - prev_raraw - prev_raguide
   prev_raguide = undoRaCorrections ? raguide : 0
   rapos += move
   ```
   The `raguide` re-add is what produces the "what tracking would have looked like unguided" series.
3. **Linear-fit** `(t, rapos)` and `(t, decraw)` separately by ordinary least squares. Use a small `LFit`-style accumulator (Σx, Σy, Σxy, Σx², n). Subtract the fit from each series → drift-corrected `rac[]`, `decc[]`.
4. **Cubic-spline resample** `rac` onto a uniform time grid: `dt = (t[n-1] - t[0]) / (n-1)`, sample at `t[0] + i·dt` for `i ∈ [0, n)`.
5. **Hamming window**: `hw[i] = 0.54 - 0.46·cos(i · 2π / (n-1))`. Multiply each resampled value by `hw[i]`.
6. **Forward FFT** via `fft.js`. Convert bin `i ∈ [0, n/2 - 1)` to:
   ```
   f = (i + 1) / (n · dt)
   period = 1 / f
   amplitude = |z| · 4 / n   // scaling per AnalysisWin.cpp:393
   ```
   Skip bin 0 (DC). Output `nfft = n/2 - 1` entries.
7. Sort by ascending period (longest period last). Track `fftAmpMax`. Build a cubic spline over the FFT for smooth display and peak-snap.

**Sign conventions:** `rac` keeps the raw integration sign. `decc` keeps `decraw`. The drift chart applies the desktop's display-time negation on Dec (`AnalysisWin.cpp:1059` uses `ymid - decc[i]`) so positive Dec points up — this is a render-time concern handled in `DriftChart.tsx`, not in `analyze.ts`.

## 6. Modal layout & interactions

**Full-screen overlay** anchored at the document root, dark theme matching the rest of the app. Layout is a vertical flex stack:

```
┌──────────────────────────────────────────────────────────┐
│ Analysis · 4321 frames · 2026-03-30 21:25 — 22:14    [×] │  ← title bar
│ [☑ RA] [☑ Dec]  [arc-sec | pixels]  [reset zoom]         │  ← toolbar
├──────────────────────────────────────────────────────────┤
│                                                          │
│        Drift-corrected RA/Dec timeline (Plotly)          │  ← top chart
│                                                          │
├──────────────────────────────────────────────────────────┤
│ Time: 1234.5s  21:25:38    Y: -0.42″ (-0.13px)           │  ← drift hover strip
├──────────────────────────────────────────────────────────┤
│                                                          │
│        Periodogram: amplitude vs period (Plotly)         │  ← bottom chart
│                                                          │
├──────────────────────────────────────────────────────────┤
│ Period: 480.0s  Amplitude: 1.23″ (0.39px)                │  ← FFT hover strip
│   P-P: 2.46″ (0.78px)  RMS: 0.87″ (0.28px)               │
└──────────────────────────────────────────────────────────┘
```

**Title bar** content variants:
- `Analysis · <N> frames · <start clock> — <end clock>` (default)
- `Analysis · RA corrections removed · …` (when `undoRaCorrections=true`)
- `Analysis · unguided section · frames <begin>–<end>` (when run from `findUnguidedWindow`)

**Drift chart** ([port of `PaintDrift`](../../../AnalysisWin.cpp#L936-L1063)):
- Two `scattergl` traces: `rac` (RA, sky-blue) and `-decc` (Dec, rose). Negation on Dec matches the desktop's display convention.
- Y axis zero-centered, units controlled by the toolbar's scale toggle (arc-sec multiplies by `ga.pixelScale`).
- X axis is elapsed seconds. Adaptive grid (Plotly's default ticks are fine; the desktop's adaptive `pow(10, ceil(log10(dt)))` matches Plotly's auto behavior closely enough).
- Plotly modebar is hidden; chart-level zoom uses the same gesture model as the main viewer (wheel = X zoom, drag ↕ = Y zoom, drag ↔ = X pan), implemented by reusing the helpers from `GuideGraph.tsx` (extracted into a shared hook — see Section 7).

**Periodogram chart** ([port of `PaintFFT`](../../../AnalysisWin.cpp#L1076-L1182)):
- One `scatter` trace (line) of `(period, amplitude)`, plus a faint filled area for visual weight.
- Y axis amplitude in arc-sec or pixels.
- X axis is **period in seconds**. Visually log-style: longer periods on the right; we use Plotly's log axis (`type: 'log'`) which gives the same effect as the desktop's `IncrP/StartP` adaptive grid.
- **Cursor snap**: on `plotly_hover`, run a peak-snap pass equivalent to `AnalysisWin.cpp:864-907`. Look ±8 px around the cursor (in screen space) for a local maximum (`a[i-1] < a[i] > a[i+1]`); if found on either side, pick the closer. Pin the readout to that snapped `(period, amplitude)`.

**Hover readouts** (pinned strips below each chart, monospace):

- *Drift hover* — `Time: 1234.5s  21:25:38    Y: -0.42″ (-0.13px)`
  - Time is elapsed seconds at the cursor.
  - Wall-clock is `session.startsMs + dt·1000` formatted `HH:MM:SS`.
  - Y is the drift-corrected value at the cursor (signed), shown in both arc-sec and pixels regardless of the active scale mode.
- *Periodogram hover* — `Period: 480.0s  Amplitude: 1.23″ (0.39px)  P-P: 2.46″ (0.78px)  RMS: 0.87″ (0.28px)`
  - Period from the snapped peak.
  - Amplitude from `fftAmplitude[i]` (pixels), also shown in arc-sec.
  - **P-P** = peak-to-peak = `2 × amplitude`.
  - **RMS** = `amplitude / √2`.
  - Format mirrors `AnalysisWin.cpp:916-918`.

**Toolbar controls:**
- **× / Esc** — close.
- **☑ RA / ☑ Dec** — show/hide each drift trace.
- **arc-sec / pixels** — scale toggle. Initially mirrors the global `viewStore.scaleMode`; can be overridden inside the modal without affecting the main viewer.
- **reset zoom** — restores both charts' axis ranges to the data extent.

**No include/exclude inside the modal.** Exclusions are configured in the main viewer; the modal consumes a snapshot of the mask taken at the moment the user clicked the menu item.

## 7. Shared chart-gesture hook

The main viewer's `GuideGraph.tsx` has grown a substantial chunk of custom drag/zoom handling that the modal's two charts also need. We'll extract this into `web/src/components/useChartGestures.ts`:

```ts
useChartGestures(plotId: string, opts: {
  scaleLocked?: boolean;
  onRangeChange?: (axis: 'x' | 'y', range: [number, number]) => void;
}): void;
```

Behavior unchanged from today's `GuideGraph` (mouse-wheel = X zoom via Plotly native, drag ↕ = continuous Y zoom, drag ↔ = X pan, rAF-throttled, hides rangeslider during drag if present). Pulled out so both `GuideGraph` and the new chart components share one implementation. **Refactor scope:** `GuideGraph.tsx` slims by ~150 lines moving the gesture wiring into the hook; behavior is verified unchanged via the existing `ui.spec.ts` per-section memory test.

## 8. State machine — `analysisStore`

```ts
type Closed = { state: 'closed' };
type Open = {
  state: 'open';
  garun: GARun;
  kind: 'all' | 'all-raw-ra' | 'unguided';
  // toolbar overrides — initialized from global, mutated only by modal:
  showRa: boolean;
  showDec: boolean;
  scaleMode: 'PIXELS' | 'ARCSEC';
};
type AnalysisState = Closed | Open;
```

Actions:
- `open({ session, mask, kind, undoRaCorrections, range })` — runs `analyze`, builds the `GARun`, transitions to `'open'`. Errors (e.g. `canAnalyze` returns false) bubble up as a toast or a no-op with a console warning.
- `close()` — back to `'closed'`. The `GARun`'s typed-array buffers are discarded (no manual disposal needed; GC handles it).
- `setShowRa(b)`, `setShowDec(b)`, `setScaleMode(m)` — modal-local toggles.

**Not persisted.** The store is in-memory only; closing the modal forgets everything.

## 9. Testing

**Unit** (Vitest):
- `spline.test.ts`:
  - Eval at the input nodes returns the input values (interpolation property).
  - On a linear ramp, eval between nodes is linear.
  - On a known cubic, eval at midpoints matches the polynomial within ~1e-9.
- `fft.test.ts`:
  - DC-only input → all bins ≈ 0 except bin 0.
  - Single sinusoid `sin(2πt/P)` with `P = 60s` and uniform `dt = 1s` recovers `period ≈ 60s` and `amplitude ≈ 1` (within tolerance) at the matching bin.
- `analyze.test.ts`:
  - Synthetic linear-ramp drift recovers the slope.
  - `undoRaCorrections=true` removes the effect of a known correction sequence.
  - Mask honoring: an excluded entry doesn't influence the linear fit.
  - `canAnalyze` returns false when fewer than 12 entries pass the filter.
  - `findUnguidedWindow` returns the first contiguous `guiding=false` run, `null` when all are guided.
- `analyze.golden.test.ts`:
  - Run `analyze` on `synthetic.log` and snapshot `{ len, nfft, fftAmpMax, driftRa, driftDec, fftPeriod[0], fftPeriod[nfft-1] }`. Locks the algorithm.

**E2E** (Playwright, in `e2e/analysis.spec.ts`):
- Right-click → "Analyze selected frames" opens the modal; both Plotly charts render; close button returns to main view.
- "Analyze selected, raw RA" opens with `RA corrections removed` in the title bar.
- Hovering the periodogram updates the strip with text matching `/Period: \d+\.\d+s/`.
- "Analyze unguided section" is disabled on `synthetic.log` (which has no unguided frames). A second test against a fixture that DOES contain unguided frames asserts it enables and the title bar reads `unguided section`.

The synthetic log will be augmented with a small unguided window (a few frames where `MountGuidingEnabled = false`) so the unguided code path has automated coverage. This is a one-line edit to the fixture and a regenerated golden.

## 10. Done definition

- All three "Analyze..." menu items are functional from the right-click menu.
- The modal renders cleanly on `synthetic.log` and on every real sample log in `sample data/`.
- Periodogram hover shows period / amplitude / P-P / RMS in the format from `AnalysisWin.cpp:916-918`.
- Drift hover shows time / wall-clock / Y readout in the format from `AnalysisWin.cpp:928-930`.
- All Vitest + Playwright tests pass.
- `parser/analyze.ts` is pure-TS, no React/DOM/store imports.
- `useChartGestures` hook is extracted; `GuideGraph` continues to pass the per-section view-memory e2e test.
- The drift slope in `GARun.driftRa` matches the linear regression in the existing `calcStats.driftRa` for the same range and mask, within 1e-6 absolute or 1e-4 relative — confirms the new module agrees with the established stats math.

## 11. Risks and open questions

- **Plotly's log-axis ticks vs. desktop's adaptive `IncrP`** — the desktop walks period decades manually with `pow(10, floor(log10(p)))`. Plotly's `type: 'log'` produces equivalent grid lines for typical periods; if the visual differs noticeably we'll switch to manual tickvals.
- **Peak-snap UX** — the desktop snaps to a 8-pixel window. In our modal we'll snap in *screen space* via the cursor's pixel position, which requires reading `_fullLayout.xaxis._offset` / `_length` (the same pattern that bit us in the wheel-zoom bug last session). Mitigation: reuse the `useChartGestures` defensive guards, and fall back to the unsnapped point when the layout coords aren't available.
- **fft.js bundle size** — the package is ~20 kB minified, no transitive deps. Acceptable.
- **Performance with very long sessions** — an N=20k FFT runs in <50 ms in pure JS. We may still want to surface a small "Analyzing…" placeholder for sessions that take >100ms; behind the same `analysisStore.open` action.
- **Unguided window with multiple runs** — if a log has more than one contiguous unguided segment, v3 only analyzes the first. Out-of-scope to add a stepper now; will revisit if it comes up.
