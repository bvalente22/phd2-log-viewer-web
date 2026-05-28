# Periodogram default Y-scale: fit the active tab's own trace

Date: 2026-05-27
Branch: `fix/residual-periodogram-yscale`

## Problem

In the Analysis modal the periodogram overlays two traces — the active mode at full
opacity and its counterpart faded (Residual error ↔ Raw RA / corrections-removed).
The default (un-zoomed) Y-axis fits the **taller of the two** traces:

```ts
// PeriodogramChart.tsx
const initialFftMax = Math.max(garun.fftAmpMax, garunOther?.fftAmpMax ?? 0) * 1.05;
```

On a well-guided segment the Raw-RA (corrections-removed) trace carries a large
long-period drift ramp (e.g. ~6.7″ on `PHD2_GuideLog_2026-03-30_161541.txt` seg 8),
while the residual's own peaks are ~0.3″. So on the **Residual error** tab the
residual is crushed into a near-flat line at the bottom and can't be read.

This is purely a display-scaling issue — the FFT itself is correct (both traces use
the same exact-N transform and share an identical period grid; confirmed empirically).

## Goal

The periodogram's default (first-paint) Y-axis fits the **active** tab's own trace
amplitude, so each tab is readable on its own. The user can still zoom, and the
existing Y-lock still pins a shared scale for cross-tab comparison. Manual zoom must
still carry across tab switches exactly as today ("only change the first paint").

## Design

Two small edits; no new state.

### 1. `web/src/components/PeriodogramChart.tsx`

The Y-axis precedence is already `yMaxLockPx ?? yMaxViewPx ?? initialFftMax`. Change
the default-only term to the active trace:

```ts
// before
const initialFftMax = Math.max(garun.fftAmpMax, garunOther?.fftAmpMax ?? 0) * 1.05;
// after
const initialFftMax = garun.fftAmpMax * 1.05;
```

Why this is sufficient and preserves cross-tab zoom persistence: `yMaxViewPx` stays
`null` until the user actually drags/wheels the Y-axis (the initial paint uses a
static `range` with `autorange:false`, which does not emit `plotly_relayout`). So:

- Open on a tab → `yMaxViewPx` null → `initialFftMax` = that tab's own trace max.
- Switch tabs without zooming → still null → re-fits to the new active trace.
- Manually zoom → `yMaxViewPx` set → carries across tab switches as today.
- Y-lock set → `yMaxLockPx` pins across tabs as today.

### 2. `web/src/components/AnalysisModal.tsx`

The Y-lock fallback (`observedMaxPx`, passed to `toggleYLock`) currently scans
**both** `activePerioRun` and `activePerioOther`. Change it to scan the **active**
run only, so locking without a prior zoom pins the scale the user is actually
looking at rather than snapping to the counterpart's much larger scale:

```ts
let observedMaxPx = 0;
for (let i = 0; i < activePerioRun.fftAmplitude.length; i++) {
  if (activePerioRun.fftAmplitude[i] > observedMaxPx) observedMaxPx = activePerioRun.fftAmplitude[i];
}
// (remove the activePerioOther loop)
```

## Consequence (accepted)

On the Residual tab the faded Raw-RA reference line is ~20× taller than the residual,
so it runs off the top of the chart (Plotly clips it). It remains in the legend as a
faint reference. This is the intended trade for a readable residual.

## Out of scope / unchanged

- The FFT (`analyze.ts` / `fft.ts`), the period grid, the peaks/table/chips/hover.
- Cross-tab manual-zoom persistence (`yMaxViewPx`) and the Y-lock comparison workflow.
- ARCSEC ↔ PIXELS handling (`k` factor) and the bottom-anchored Y-zoom gesture.
- The unguided / spike tabs (unguided has no counterpart; spike is single-trace).

## Verification

UI-only change; no unit test (the repo verifies chart behavior in-browser). Confirm
on `PHD2_GuideLog_2026-03-30_161541.txt` segment 8:

- Open Analysis → Raw RA tab fits the raw trace (~7″), unchanged from today.
- Switch to Residual error → now fits the residual (~0.3″); residual structure is
  visible; faded Raw-RA line clips off the top.
- Zoom the residual Y, switch to Raw RA → the zoom carries across (unchanged).
- Y-lock with no prior zoom on the Residual tab → pins at the residual's own scale.
- Toggle ARCSEC ↔ PIXELS → range rescales without jumping.
- `npx tsc --noEmit` clean; `npx vitest run` green.
