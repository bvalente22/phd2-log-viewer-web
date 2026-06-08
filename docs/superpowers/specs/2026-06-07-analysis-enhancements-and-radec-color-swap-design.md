# Analysis-screen enhancements + global RA/Dec color swap — design

**Date:** 2026-06-07
**Status:** approved (brainstorming), pending spec review
**Rollback anchor:** tag `stable-2026-06-06-rms` (`main` @ 16167a4) is the pre-feature known-good point.

## Summary

Five independent enhancements, four to the Analysis modal and one global chart preference:

1. **(Item 4)** Convert the Analysis **top (drift) chart** X axis to wall-clock time, mirroring the main GuideGraph.
2. **(Item 2)** Add a **Period Ratio** to each top-peak card, anchored to the Raw-RA primary period.
3. **(Item 3)** Add a **Ramp** value to each top-peak card.
4. **(Item 6)** Show the **Period Ratio** for the hovered period in the periodogram hover strip.
5. **(Item 5)** A **global, persisted RA/Dec trace-color swap** (RA-blue/Dec-red ↔ RA-red/Dec-blue) applied to every chart **except the periodogram**.

The original "Item 1" (periodogram hover showing both Raw RA + Residual amplitudes) is **already implemented** and is dropped from scope.

All work targets `web/`. No parser-format or storage-schema changes.

## Shared concept: the "primary period"

Several items divide by a single **primary period**:

> The primary period is the **largest-amplitude peak at or below the Max Period filter** (the dominant periodic error), computed on the **Raw RA** periodogram (the GA run whose `undoRaCorrections === true`). It anchors **both** the Raw RA and Residual-error tabs, so a residual harmonic at half the period reads `2.0x` relative to the raw fundamental.
>
> *(Revised 2026-06-07: originally the longest-period peak ≤ max, but that latched onto tiny long-period bumps — e.g. a small 461s peak beating the obvious 376.7s dominant — so it now picks the dominant peak by amplitude.)*

- The Raw RA run is always reachable in `AnalysisModal`: it is whichever of `garun` / `garunOther` has `undoRaCorrections === true` (`setKind` swaps the pair, so the active `garun` alternates, but the Raw-RA member is identifiable by that flag).
- **Peaks** are local maxima of the dense Akima curve (`densePeriodogram` → `curveLocalMaxima`), the same source the cards and chips already use, so the primary always lands on a visible curve peak.
- "Largest-amplitude peak ≤ Max Period" — among those local maxima with `period <= maxPeriodSec`, pick the one with the **largest amplitude**. On Raw RA this is the PE fundamental (its harmonics are smaller-amplitude). Equivalently, it is the `#1` entry of `curveTopPeaks(curve, 1, maxPeriodSec)`.
- **Unguided** mode has no Raw-RA counterpart: the primary is the largest-amplitude peak ≤ Max Period in its single curve.
- Implemented as a pure helper, e.g. `primaryPeriod(curve, maxPeriodSec): number | null`, in `web/src/parser/perioPeaks.ts` (unit-tested), returning `null` when no peak qualifies (ratios then omitted/blank).

## Item 4 — Top (drift) chart wall-clock X axis

**File:** `web/src/components/DriftChart.tsx`.

Mirror the proven approach already in `GuideGraph.tsx`:

- When `garun.starts != null`, map trace X to **ms since epoch**: `x = garun.starts + t*1000`. Set the axis `type: 'date'` with `tickformat: '%H:%M'`. When `garun.starts == null` (unguided / no parseable timestamp), keep the current elapsed-seconds **linear** axis (`tChart('axes.time')`).
- `xExtent` becomes `[starts + t[0]*1000, starts + t[last]*1000]` in clock-time mode.
- `onRelayout` and the `driftXRangeView` persistence must coerce Plotly's **date-string** range values → ms (Plotly emits ISO strings like `"2026-06-05 23:51:53"` on a `type:'date'` axis). Reuse the same `toMs` coercion GuideGraph uses.
- The hover strip already prints clock time (`Time: 123.45s  19:43:07   Y: …″`) via `formatClock` (UTC-based, consistent with Plotly's UTC date-axis rendering — same basis GuideGraph relies on). Keep it; it now matches the axis. This also removes the prior mismatch (axis in seconds, readout in clock time).
- Gestures (`useChartGestures`), the dashed hover cursor, and Y handling are unchanged.

**Acceptance:** opening Analysis on a timestamped log shows the top chart's X axis as `HH:MM` clock labels matching the main guide graph for the same session; drag-pan/zoom and the bottom readout still work; an unguided/no-timestamp log still shows elapsed seconds.

## Item 2 — Period Ratio on top-peak cards

**File:** `web/src/components/AnalysisModal.tsx` (the regular `peaks.map(...)` cards for residual / raw-RA / unguided modes; the hidden spike cards are out of scope).

- Compute `primary = primaryPeriod(rawRaCurve, maxPeriodSec)` once (Raw-RA curve per the shared concept).
- For each displayed peak, **Ratio = `primary / peak.period`**, formatted **1 decimal place + `x`** → `1.0x`, `2.0x`, `2.7x`. The primary peak reads `1.0x`. When `primary` is `null`, omit the ratio.
- **Placement:** on the **same line as Period**, to the right, labeled `Ratio` (no colon):
  `Period: 400.0s   Ratio 1.0x`.

## Item 3 — Ramp on top-peak cards

**File:** same cards in `AnalysisModal.tsx`.

- **Ramp = `(displayedAmplitude / peak.period) * 1000`**, formatted **2 decimal places**, **no unit** → `Ramp 5.75`.
- `displayedAmplitude` **follows the arc-sec/pixels scale toggle**: arc-sec amplitude (`p.amplitude * pixelScale`) in ARCSEC mode, pixel amplitude (`p.amplitude`) in PIXELS mode. (So flipping the scale toggle changes Ramp.)
- **Placement:** same line as Period/Ratio, to the right of Ratio:
  `Period: 400.0s   Ratio 1.0x   Ramp 5.75`.

Resulting card:

```
  PEAK 1
  Period: 400.0s   Ratio 1.0x   Ramp 5.75
  Amplitude: 2.30″ (0.36px)
  P-P: 4.60″ (0.71px)
  RMS: 1.63″ (0.25px)
```

## Item 6 — Period Ratio in the periodogram hover strip

**File:** `web/src/components/PeriodogramChart.tsx`.

- Add a new prop `primaryPeriodSec: number | null`, supplied by `AnalysisModal` from the **same** `primaryPeriod(...)` computation (single source of truth shared with the cards).
- In `onHover`, after snapping to a peak, insert `Ratio {(primary/period).toFixed(1)}x` immediately after the period, in both:
  - the dual-trace residual/raw-RA readout:
    `Period: 200.00s   Ratio 2.0x   Raw RA: 2.30″   Residual error: 0.30″`
  - the unguided single-trace readout (primary from the single curve):
    `Period: 200.00s   Ratio 2.0x   Amplitude: …   P-P: …   RMS: …`
- When `primaryPeriodSec` is `null`, omit the `Ratio` token. **Spike mode** is unchanged (no meaningful primary; tab is hidden).
- Ramp is **not** added to the hover strip (cards only).

## Item 5 — Global RA/Dec trace-color swap

**Goal:** one persisted preference that swaps the two existing trace hues — default RA `#60a5fa` (blue) / Dec `#f87171` (red), swapped → RA red / Dec blue — across **every** chart that draws RA/Dec (or the calibration West/North equivalents), **excluding the periodogram** (it uses teal/amber `fft*` colors and is untouched).

### State
`web/src/state/viewStore.ts`:
- Add `swapRaDec: boolean` (default `false`), `setSwapRaDec(b)`, and include `swapRaDec` in `partialize` so it persists like `theme`.

### Color source
`web/src/themes.ts` (or a small adjacent module):
- Add the two canonical hues as named constants and a helper:
  `raDecColors(swap: boolean): { ra: string; dec: string }`
  returning `{ ra: BLUE, dec: RED }` normally and `{ ra: RED, dec: BLUE }` when swapped. (Hues stay constant across visual themes, as today.)

### Consumers — replace hardcoded `RA_COLOR`/`DEC_COLOR` module constants
Each of the **8** components reads `swapRaDec` from `useViewStore` and derives `{ ra, dec }` via the helper:
- `GuideGraph.tsx` (lines ~235, 248, 421 — RA/Dec traces + pulse color)
- `DriftChart.tsx` (RA/Dec traces)
- `ScatterView.tsx` (time-gradient colorscale `[ra, dec]`)
- `CalibrationPlot.tsx` (West/East → RA hue, North/South → Dec hue)
- `BurstChart.tsx`, `SpikeChart.tsx`, `SimpleSpikeChart.tsx`, `ManualSpikeChart.tsx` (`run.axis === 'ra' ? ra : dec`)

For components not already subscribing to `useViewStore`, add the subscription. Module-level `const RA_COLOR`/`DEC_COLOR` are removed in favor of the per-render derivation.

### UI control
New `web/src/components/RaDecColorPicker.tsx`, modeled on `ThemePicker.tsx` (native `<select>`, same classes), placed in the header **next to the 🎨 theme picker** in `web/src/pages/ViewerPage.tsx`:
- Two options: `RA Blue / Dec Red` (value `false`) and `RA Red / Dec Blue` (value `true`).
- i18n keys under `common` (label + tooltip + the two option labels) for all six locales; astrophotography terms (RA/Dec) stay English per `locales/README.md`.

**Acceptance:** toggling the header control instantly recolors RA/Dec on the guide graph, scatter, calibration, drift, and spike/manual/simple/burst charts; the periodogram is unaffected; the choice survives a reload (persisted) and applies per-browser like theme.

## Testing

- **Unit (vitest):**
  - `primaryPeriod(curve, maxPeriodSec)` in `perioPeaks.test.ts`: picks the longest-period local max ≤ max; returns `null` when none qualify; ignores peaks above max.
  - Ratio/Ramp formatting helpers if extracted (else covered by card rendering).
  - `raDecColors(swap)` returns the expected pair both ways.
  - `viewStore` persists `swapRaDec` (mirrors existing persistence tests if present).
- **Type/build:** `tsc --noEmit` clean; full `vitest run` green.
- **Manual (Playwright MCP)** on `sample data/QuarkPHD2_GuideLog_2026-06-05_223909.txt`:
  - Top drift chart shows `HH:MM` matching the guide graph; unguided log shows seconds.
  - Card shows `Period … Ratio … Ramp …`; the longest Raw-RA peak reads `1.0x`; switching to Residual keeps ratios anchored to the Raw-RA primary.
  - Hover strip shows `Ratio` for the snapped period.
  - Header swap recolors all non-periodogram charts and persists across reload.

## Out of scope / non-goals

- No change to periodogram colors, FFT math, peak detection, or the RMS work from PR #70.
- No change to spike/burst/simple tabs (hidden) beyond inheriting the RA/Dec color swap.
- Ramp is not unit-labeled and not shown in the hover strip.
- Per-log or cross-device color sync (preference is per-browser localStorage, like theme).

## Rollback

All changes are additive and confined to `web/`. Revert path: the feature branch's commits, or `git reset --hard stable-2026-06-06-rms`. The color swap defaults to `false` (current appearance) so absent/cleared persistence is a no-op visual change.
