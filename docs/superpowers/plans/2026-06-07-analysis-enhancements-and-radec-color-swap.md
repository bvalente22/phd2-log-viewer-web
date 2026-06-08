# Analysis-screen enhancements + global RA/Dec color swap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four Analysis-modal readouts (drift-chart wall-clock X axis; Period Ratio + Ramp on peak cards; Period Ratio in the periodogram hover) and one global, persisted RA/Dec trace-color swap applied to every chart except the periodogram.

**Architecture:** Pure helpers in `parser/perioPeaks.ts` (primary period, ratio, ramp) and `themes.ts` (`raDecColors`) are unit-tested first, then consumed by the chart components. A new `swapRaDec` boolean in the persisted `viewStore` drives color selection across 8 chart components; the Analysis modal computes the Raw-RA "primary period" once and feeds both the peak cards and the periodogram hover.

**Tech Stack:** React + TypeScript, Zustand (persisted store), Plotly.js, react-i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-analysis-enhancements-and-radec-color-swap-design.md`

**Branch:** `feat/analysis-enhancements-radec-swap` (already created; spec committed). **Rollback anchor:** tag `stable-2026-06-06-rms`.

**Conventions:**
- Verify per task: `cd web && npx tsc --noEmit` and `cd web && npx vitest run`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Build git commit messages with the Bash heredoc** (`git commit -F - <<'EOF' … EOF`), NOT a PowerShell here-string — commits here run through the Bash tool.

---

## Task 1: `swapRaDec` view state + `raDecColors` helper

**Files:**
- Modify: `web/src/themes.ts`
- Modify: `web/src/state/viewStore.ts`
- Test: `web/src/themes.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `web/src/themes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { raDecColors, RA_DEC_BLUE, RA_DEC_RED } from './themes';

describe('raDecColors', () => {
  it('returns RA blue / Dec red by default', () => {
    expect(raDecColors(false)).toEqual({ ra: RA_DEC_BLUE, dec: RA_DEC_RED });
  });
  it('swaps to RA red / Dec blue', () => {
    expect(raDecColors(true)).toEqual({ ra: RA_DEC_RED, dec: RA_DEC_BLUE });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/themes.test.ts`
Expected: FAIL — `raDecColors` / `RA_DEC_BLUE` not exported.

- [ ] **Step 3: Add the helper to `themes.ts`**

Append to `web/src/themes.ts` (after the `themeOf` export at the bottom):

```ts
/**
 * Canonical RA / Dec trace hues. RA is sky-blue and Dec is rose by default; the
 * global `swapRaDec` view preference exchanges them everywhere EXCEPT the
 * periodogram (which uses the fft* colors). Hues are intentionally constant
 * across visual themes — they encode axis identity, not surface styling.
 */
export const RA_DEC_BLUE = '#60a5fa';
export const RA_DEC_RED = '#f87171';
export const raDecColors = (swap: boolean): { ra: string; dec: string } =>
  swap ? { ra: RA_DEC_RED, dec: RA_DEC_BLUE } : { ra: RA_DEC_BLUE, dec: RA_DEC_RED };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/themes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add `swapRaDec` to the view store**

In `web/src/state/viewStore.ts`:

1. In the `ViewState` interface, after `theme: ThemeId;` (line ~100) add:
```ts
  /**
   * Swap the RA / Dec trace colors (RA-blue/Dec-red ↔ RA-red/Dec-blue) across
   * every chart except the periodogram. Persisted per-browser like `theme`.
   */
  swapRaDec: boolean;
```
2. In the interface's action list, after `setTheme: (t: ThemeId) => void;` add:
```ts
  setSwapRaDec: (b: boolean) => void;
```
3. In the store initializer, after `theme: DEFAULT_THEME,` (line ~159) add:
```ts
  swapRaDec: false,
```
4. After `setTheme: (t) => set({ theme: t }),` add:
```ts
  setSwapRaDec: (b) => set({ swapRaDec: b }),
```
5. In `partialize` (after `theme: s.theme,`, line ~311) add:
```ts
    swapRaDec: s.swapRaDec,
```

- [ ] **Step 6: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd "z:/HomeLab-Repos/PHDLogViewer" && git add web/src/themes.ts web/src/themes.test.ts web/src/state/viewStore.ts && git commit -F - <<'EOF'
feat: add swapRaDec view state + raDecColors helper

Persisted RA/Dec color-swap preference and a pure helper returning the
RA/Dec hue pair (swapped or not). Not yet consumed by charts.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: `primaryPeriod` / `periodRatio` / `rampValue` helpers

**Files:**
- Modify: `web/src/parser/perioPeaks.ts`
- Test: `web/src/parser/__tests__/perioPeaks.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `web/src/parser/__tests__/perioPeaks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { primaryPeriod, periodRatio, rampValue } from '../perioPeaks';

// Curve with local maxima at periods 100 (amp 5), 200 (amp 4), 400 (amp 6),
// 800 (amp 9). 800 is the highest amplitude but exceeds typical max-period.
const curve = {
  x: [50, 100, 150, 200, 250, 400, 550, 800, 1000],
  y: [1, 5, 1, 4, 1, 6, 1, 9, 1],
};

describe('primaryPeriod', () => {
  it('picks the LONGEST-period peak at or below maxPeriodSec (not the highest amplitude)', () => {
    expect(primaryPeriod(curve, 600)).toBe(400);
  });
  it('includes peaks up to and including maxPeriodSec', () => {
    expect(primaryPeriod(curve, 800)).toBe(800);
  });
  it('returns null when no peak qualifies', () => {
    expect(primaryPeriod(curve, 50)).toBeNull();
  });
});

describe('periodRatio', () => {
  it('is primary / period', () => {
    expect(periodRatio(400, 200)).toBeCloseTo(2);
    expect(periodRatio(400, 400)).toBeCloseTo(1);
  });
});

describe('rampValue', () => {
  it('is amplitude / period scaled by 1000', () => {
    expect(rampValue(2.3, 400)).toBeCloseTo(5.75);
    expect(rampValue(0.36, 400)).toBeCloseTo(0.9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/parser/__tests__/perioPeaks.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Add the helpers to `perioPeaks.ts`**

Append to `web/src/parser/perioPeaks.ts`:

```ts
/**
 * The "primary period" for period-ratio readouts: the LONGEST-period local-max
 * peak at or below `maxPeriodSec`. On the Raw-RA periodogram this is the
 * periodic-error fundamental (also its #1-amplitude peak); ratios on both the
 * Raw-RA and Residual tabs divide by this single anchor so a residual harmonic
 * at half the period reads 2x. Returns null when no peak qualifies.
 */
export function primaryPeriod(
  curve: { x: number[]; y: number[] },
  maxPeriodSec: number,
): number | null {
  let best: number | null = null;
  for (const m of curveLocalMaxima(curve)) {
    if (m.period > maxPeriodSec) continue;
    if (best === null || m.period > best) best = m.period;
  }
  return best;
}

/** Ratio of the primary period to a peak's period (primary / period). */
export function periodRatio(primaryPeriodSec: number, periodSec: number): number {
  return periodSec > 0 ? primaryPeriodSec / periodSec : 0;
}

/**
 * "Ramp" readout = amplitude / period, scaled ×1000 so the typically tiny value
 * shows digits left of the decimal. `amplitude` is in whatever unit the caller
 * displays (arc-sec or px), so ramp follows the scale toggle.
 */
export function rampValue(amplitude: number, periodSec: number): number {
  return periodSec > 0 ? (amplitude / periodSec) * 1000 : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/parser/__tests__/perioPeaks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd "z:/HomeLab-Repos/PHDLogViewer" && git add web/src/parser/perioPeaks.ts web/src/parser/__tests__/perioPeaks.test.ts && git commit -F - <<'EOF'
feat: primaryPeriod / periodRatio / rampValue periodogram helpers

Pure helpers for the upcoming Period Ratio + Ramp readouts. primaryPeriod
picks the longest-period peak <= max (the Raw-RA fundamental anchor).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Item 4 — drift chart wall-clock X axis

**Files:**
- Modify: `web/src/components/DriftChart.tsx`

This is a UI change verified in-browser (no unit test; matches the codebase's pattern for chart components).

- [ ] **Step 1: Add clock-time conversion**

In `web/src/components/DriftChart.tsx`, after these lines (~59-60):
```ts
  const k = scaleMode === 'ARCSEC' ? garun.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';
```
insert:
```ts
  // Clock-time X axis (ms-since-epoch on a Plotly `type:'date'` axis) when the
  // run has a parseable wall-clock start — mirrors the main GuideGraph so the
  // analysis drift chart and the guide chart read the same times. Falls back to
  // elapsed seconds for unguided / unparseable logs.
  const startsMs = garun.starts;
  const useClockTime = startsMs !== null && Number.isFinite(startsMs);
  const toX = useCallback(
    (dt: number) => (useClockTime ? (startsMs as number) + dt * 1000 : dt),
    [useClockTime, startsMs],
  );
```
(`useCallback` is already imported.)

- [ ] **Step 2: Map trace X through `toX`**

In the `traces` memo, change:
```ts
    const x = Array.from(garun.t);
```
to:
```ts
    const x = Array.from(garun.t).map(toX);
```
and change the memo dep array from `[garun, showRa, showDec, k]` to `[garun, showRa, showDec, k, toX]`.

- [ ] **Step 3: Map the X extent through `toX`**

Replace the `xExtent` memo:
```ts
  const xExtent = useMemo<[number, number]>(() => {
    const t = garun.t;
    if (t.length < 2) return [0, 1];
    return [t[0], t[t.length - 1]];
  }, [garun]);
```
with:
```ts
  const xExtent = useMemo<[number, number]>(() => {
    const t = garun.t;
    if (t.length < 2) return [toX(0), toX(1)];
    return [toX(t[0]), toX(t[t.length - 1])];
  }, [garun, toX]);
```

- [ ] **Step 4: Coerce date-string ranges in `onRelayout`**

In `onRelayout`, replace this block:
```ts
    const x0 = ev['xaxis.range[0]'];
    const x1 = ev['xaxis.range[1]'];
    const xrange = ev['xaxis.range'];
    if (typeof x0 === 'number' && typeof x1 === 'number') {
      lo = x0; hi = x1;
    } else if (Array.isArray(xrange) && xrange.length >= 2) {
      const a = xrange[0]; const b = xrange[1];
      if (typeof a === 'number' && typeof b === 'number') { lo = a; hi = b; }
    }
```
with:
```ts
    // On a `type:'date'` axis Plotly emits range values as ISO strings
    // ("2026-06-05 23:51:53"); coerce both number and string forms to ms.
    const toMs = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
      return null;
    };
    const x0 = toMs(ev['xaxis.range[0]']);
    const x1 = toMs(ev['xaxis.range[1]']);
    const xrange = ev['xaxis.range'];
    if (x0 !== null && x1 !== null) {
      lo = x0; hi = x1;
    } else if (Array.isArray(xrange) && xrange.length >= 2) {
      const a = toMs(xrange[0]); const b = toMs(xrange[1]);
      if (a !== null && b !== null) { lo = a; hi = b; }
    }
```

- [ ] **Step 5: Make the X axis a date axis**

In the `layout.xaxis` object, after the line:
```ts
      title: { text: tChart('axes.time') }, gridcolor: tc.grid, zerolinecolor: tc.zeroline,
```
insert:
```ts
      type: useClockTime ? 'date' : 'linear',
      tickformat: useClockTime ? '%H:%M' : undefined,
```

- [ ] **Step 6: Verify build + behavior**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

Browser check (dev server on 5173): open Analysis on `sample data/QuarkPHD2_GuideLog_2026-06-05_223909.txt` (a timestamped session). Expected: the top drift chart's X axis shows `HH:MM` clock labels matching the main guide graph; drag-pan/zoom still works; the bottom readout still shows `Time: …s  HH:MM:SS  Y: …`. (Unguided/no-timestamp logs still show elapsed seconds.)

- [ ] **Step 7: Commit**

```bash
cd "z:/HomeLab-Repos/PHDLogViewer" && git add web/src/components/DriftChart.tsx && git commit -F - <<'EOF'
feat: wall-clock X axis on the analysis drift chart (item 4)

Mirror GuideGraph's clock-time handling: ms-since-epoch X on a Plotly
type:'date' axis with %H:%M ticks when the run has a parseable start;
elapsed seconds otherwise. Coerce date-string relayout ranges to ms.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Items 2, 3, 6 — Period Ratio + Ramp on cards, Ratio in periodogram hover

**Files:**
- Modify: `web/src/components/AnalysisModal.tsx`
- Modify: `web/src/components/PeriodogramChart.tsx`
- Modify: `web/src/i18n/locales/en/analysis.json`

- [ ] **Step 1: Add i18n keys**

In `web/src/i18n/locales/en/analysis.json`, add two keys (alongside the existing `period` / `amplitude` keys):
```json
  "ratio": "Ratio",
  "ramp": "Ramp",
```
(Other locales fall back to English via `fallbackLng:'en'`, consistent with prior features.)

- [ ] **Step 2: Import the helpers in AnalysisModal**

In `web/src/components/AnalysisModal.tsx`, change:
```ts
import { densePeriodogram, curveTopPeaks } from '../parser/perioPeaks';
```
to:
```ts
import { densePeriodogram, curveTopPeaks, primaryPeriod, periodRatio, rampValue } from '../parser/perioPeaks';
```

- [ ] **Step 3: Compute the Raw-RA primary period (one source of truth)**

In `AnalysisModal`, immediately after the `peaks` memo (ends ~line 143), add:
```ts
  // Primary period for the Ratio readouts. Anchored to the RAW RA curve on BOTH
  // tabs: setKind swaps garun/garunOther, so the Raw-RA run is the member with
  // undoRaCorrections === true. Unguided has a single curve.
  const primaryPeriodSec = useMemo<number | null>(() => {
    if (s.state !== 'open') return null;
    if (s.kind === 'spike') return null;
    const rawRa = s.kind === 'unguided'
      ? s.garun
      : s.garun.undoRaCorrections
      ? s.garun
      : s.garunOther && s.garunOther.undoRaCorrections
      ? s.garunOther
      : null;
    if (!rawRa) return null;
    const curve = densePeriodogram(rawRa.fftPeriod, rawRa.fftSpline);
    return primaryPeriod(curve, s.maxPeriodSec);
  }, [s]);
```

- [ ] **Step 4: Add Ratio + Ramp to each peak card's Period line**

In the regular-peaks render block, replace this line (inside `peaks.map`, ~line 865):
```tsx
                  <div>{t('period')}: {fmtNumber(p.period, 1)}s</div>
```
with:
```tsx
                  <div>
                    {t('period')}: {fmtNumber(p.period, 1)}s
                    {primaryPeriodSec !== null && (
                      <>{'  '}{t('ratio')} {fmtNumber(periodRatio(primaryPeriodSec, p.period), 1)}x</>
                    )}
                    {'  '}{t('ramp')} {fmtNumber(rampValue(scaleMode === 'ARCSEC' ? aArc : aPx, p.period), 2)}
                  </div>
```
(`aArc`, `aPx`, and `scaleMode` are already in scope inside this map callback.)

- [ ] **Step 5: Pass the primary to the periodogram**

In the `<PeriodogramChart .../>` element (~line 759), add the prop:
```tsx
            primaryPeriodSec={primaryPeriodSec}
```

- [ ] **Step 6: Accept the prop in PeriodogramChart**

In `web/src/components/PeriodogramChart.tsx`:

1. In `interface PeriodogramChartProps`, after the `topPeaks` field, add:
```ts
  /** Raw-RA primary period (longest peak <= max) for the hover Ratio readout.
   *  Null when unavailable (no qualifying peak / spike mode). */
  primaryPeriodSec: number | null;
```
2. In the function signature destructure, add `primaryPeriodSec`:
```ts
export function PeriodogramChart({ garun, garunOther, kind, scaleMode, yMaxLockPx, yMaxViewPx, topPeaks, primaryPeriodSec }: PeriodogramChartProps) {
```

- [ ] **Step 7: Insert the Ratio token in both hover readouts**

In `onHover`, in the dual-trace branch, replace:
```ts
      setHover(
        `Period: ${period.toFixed(2)}s    ` +
        `${t('mode.rawRa')}: ${rawRaDisp.toFixed(2)}${u}    ` +
        `${t('mode.selected')}: ${residualDisp.toFixed(2)}${u}`,
      );
```
with:
```ts
      const ratioStr = primaryPeriodSec != null && period > 0
        ? `${t('ratio')} ${(primaryPeriodSec / period).toFixed(1)}x    `
        : '';
      setHover(
        `Period: ${period.toFixed(2)}s    ` +
        ratioStr +
        `${t('mode.rawRa')}: ${rawRaDisp.toFixed(2)}${u}    ` +
        `${t('mode.selected')}: ${residualDisp.toFixed(2)}${u}`,
      );
```

In the unguided/single-trace branch, replace:
```ts
      setHover(
        `Period: ${period.toFixed(2)}s  Amplitude: ${aArc.toFixed(2)}″ (${aPx.toFixed(2)}px)  ` +
        `P-P: ${ppArc.toFixed(2)}″ (${ppPx.toFixed(2)}px)  ` +
        `RMS: ${rmsArc.toFixed(2)}″ (${rmsPx.toFixed(2)}px)`,
      );
```
with:
```ts
      const ratioStr = primaryPeriodSec != null && period > 0
        ? `${t('ratio')} ${(primaryPeriodSec / period).toFixed(1)}x  `
        : '';
      setHover(
        `Period: ${period.toFixed(2)}s  ${ratioStr}Amplitude: ${aArc.toFixed(2)}″ (${aPx.toFixed(2)}px)  ` +
        `P-P: ${ppArc.toFixed(2)}″ (${ppPx.toFixed(2)}px)  ` +
        `RMS: ${rmsArc.toFixed(2)}″ (${rmsPx.toFixed(2)}px)`,
      );
```

Then add `primaryPeriodSec` to the `onHover` `useCallback` dependency array (it currently ends `…, setSpikeHoverPeriod, t]`).

- [ ] **Step 8: Verify build + behavior**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

Browser check on the sample log: each peak card shows `Period: 400.0s   Ratio 1.0x   Ramp 5.75`; the longest Raw-RA peak reads `Ratio 1.0x`; switching to the Residual tab keeps ratios anchored to the Raw-RA primary (a residual peak near half the primary reads ~`2.0x`); flipping arc-sec↔pixels changes the Ramp value. Hovering the periodogram shows `Period: …   Ratio …x   Raw RA: …   Residual error: …`.

- [ ] **Step 9: Commit**

```bash
cd "z:/HomeLab-Repos/PHDLogViewer" && git add web/src/components/AnalysisModal.tsx web/src/components/PeriodogramChart.tsx web/src/i18n/locales/en/analysis.json && git commit -F - <<'EOF'
feat: Period Ratio + Ramp on peak cards and periodogram hover (items 2,3,6)

Cards gain "Ratio Nx" (Raw-RA-anchored primary / period) and "Ramp"
(displayed amplitude / period * 1000) on the Period line. The periodogram
hover strip gains the same Ratio for the snapped period.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Item 5 (part 1) — apply the color swap in the 8 chart components

Each consumer reads `swapRaDec` and derives `{ ra, dec }` via `raDecColors`, destructured to the existing local names `RA_COLOR` / `DEC_COLOR` so downstream usage is unchanged. The periodogram is intentionally NOT touched. Until Task 6 adds the UI, `swapRaDec` stays `false` (no visual change), so this task is safe to land on its own.

**Files (modify):** `BurstChart.tsx`, `SpikeChart.tsx`, `SimpleSpikeChart.tsx`, `ManualSpikeChart.tsx`, `DriftChart.tsx`, `ScatterView.tsx`, `CalibrationPlot.tsx`, `GuideGraph.tsx` — all under `web/src/components/`. All already import `useViewStore`.

- [ ] **Step 1: Four simple spike/burst charts**

For EACH of `BurstChart.tsx`, `SpikeChart.tsx`, `SimpleSpikeChart.tsx`, `ManualSpikeChart.tsx`:

1. Delete the two module constants:
```ts
const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
```
2. Add to the existing `'../themes'` import if present, else add a new import:
```ts
import { raDecColors } from '../themes';
```
3. Inside the component function body, before the `const traceColor = run.axis === 'ra' ? RA_COLOR : DEC_COLOR;` line, add:
```ts
  const swapRaDec = useViewStore((s) => s.swapRaDec);
  const { ra: RA_COLOR, dec: DEC_COLOR } = raDecColors(swapRaDec);
```

- [ ] **Step 2: DriftChart (compute colors inside the traces memo)**

In `web/src/components/DriftChart.tsx`:

1. Delete:
```ts
const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
```
2. Add `raDecColors` to the `'../themes'` import:
```ts
import { themeOf, raDecColors } from '../themes';
```
3. Add a selector near the other `useViewStore` selectors at the top of the component:
```ts
  const swapRaDec = useViewStore((s) => s.swapRaDec);
```
4. At the top of the `traces` memo body (first line inside `useMemo(() => {`), add:
```ts
    const { ra: RA_COLOR, dec: DEC_COLOR } = raDecColors(swapRaDec);
```
5. Add `swapRaDec` to the `traces` memo dependency array (currently `[garun, showRa, showDec, k, toX]`).

- [ ] **Step 3: ScatterView (compute colors inside the data memo)**

In `web/src/components/ScatterView.tsx`:

1. Delete:
```ts
const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
```
2. Add `raDecColors` to the `'../themes'` import:
```ts
import { themeOf, raDecColors } from '../themes';
```
3. Add a selector near the other `useViewStore` selectors:
```ts
  const swapRaDec = useViewStore((s) => s.swapRaDec);
```
4. At the top of the `data` memo body (first line inside `useMemo(() => {`), add:
```ts
    const { ra: RA_COLOR, dec: DEC_COLOR } = raDecColors(swapRaDec);
```
5. Add `swapRaDec` to the `data` memo dependency array (currently `[log, sectionIdx, exclusions, scaleMode, device]`).

- [ ] **Step 4: CalibrationPlot (thread a color map through the builders)**

In `web/src/components/CalibrationPlot.tsx`:

1. Replace the color constants + `COLORS` map (lines 11-22):
```ts
const RA_COLOR = '#60a5fa';
const RA_DARK = '#1d4ed8';
const DEC_COLOR = '#f87171';
const DEC_DARK = '#991b1b';

const COLORS: Record<CalDirection, string> = {
  WEST: RA_COLOR,
  EAST: RA_DARK,
  NORTH: DEC_COLOR,
  SOUTH: DEC_DARK,
  BACKLASH: DEC_DARK,
};
```
with:
```ts
// Darker companion shades for the second direction of each axis (East/South).
const BLUE_DARK = '#1d4ed8';
const RED_DARK = '#991b1b';

// West/East belong to the RA color family, North/South/Backlash to the Dec
// family; swapping exchanges the whole family (main + dark shade).
function calColors(swap: boolean): Record<CalDirection, string> {
  const { ra, dec } = raDecColors(swap);
  const raDark = swap ? RED_DARK : BLUE_DARK;
  const decDark = swap ? BLUE_DARK : RED_DARK;
  return { WEST: ra, EAST: raDark, NORTH: dec, SOUTH: decDark, BACKLASH: decDark };
}
```
2. Add `raDecColors` to the `'../themes'` import:
```ts
import { themeOf, raDecColors } from '../themes';
```
3. Change `buildTraces` signature and body:
```ts
function buildTraces(cal: Calibration, colors: Record<CalDirection, string>): Data[] {
```
and inside it replace both `COLORS[dir]` occurrences (marker color + textfont color) with `colors[dir]`.
4. Change `buildAxisShapes` signature and the two line colors:
```ts
function buildAxisShapes(cal: Calibration, colors: Record<CalDirection, string>): Partial<Shape>[] {
```
- West line: `line: { color: RA_COLOR, width: 2 },` → `line: { color: colors.WEST, width: 2 },`
- North line: `line: { color: DEC_COLOR, width: 2 },` → `line: { color: colors.NORTH, width: 2 },`
5. In the component, find the `useMemo` that returns `{ traces: buildTraces(cal), shapes: buildAxisShapes(cal), … }` (lines ~118-121). Add, just before the build calls:
```ts
    const swapRaDec = useViewStore.getState().swapRaDec;
    const colors = calColors(swapRaDec);
```
…and change the build calls to `buildTraces(cal, colors)` / `buildAxisShapes(cal, colors)`.
   To make the chart re-render when the toggle changes, add a subscription at the top of the component:
```ts
  const swapRaDec = useViewStore((s) => s.swapRaDec);
```
   and use that `swapRaDec` in the memo (replace the `useViewStore.getState()` line above with `const colors = calColors(swapRaDec);`) and add `swapRaDec` to that memo's dependency array.

- [ ] **Step 5: GuideGraph (thread colors through module-scope builders)**

In `web/src/components/GuideGraph.tsx`:

1. Delete:
```ts
const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';
```
2. Add `raDecColors` to the `'../themes'` import (currently imports `themeOf`):
```ts
import { themeOf, raDecColors } from '../themes';
```
3. `buildTraces`: add two params after `snrColor: string,`:
```ts
  raColor: string,
  decColor: string,
```
and replace `color: RA_COLOR` (RA trace) with `color: raColor`, and `color: DEC_COLOR` (Dec trace) with `color: decColor`.
4. `pushLimitLines`: add two params after `k: number,`:
```ts
  raColor: string,
  decColor: string,
```
and replace `const color = axis === 'ra' ? RA_COLOR : DEC_COLOR;` with `const color = axis === 'ra' ? raColor : decColor;`.
5. `buildShapes`: add two params after `toX: (dt: number) => number,`:
```ts
  raColor: string,
  decColor: string,
```
and update its two `pushLimitLines` calls:
```ts
  if (traces.raLimits) pushLimitLines(shapes, 'ra', s, k, raColor, decColor);
  if (traces.decLimits) pushLimitLines(shapes, 'dec', s, k, raColor, decColor);
```
6. In the component, add a selector near the other `useViewStore` selectors:
```ts
  const swapRaDec = useViewStore((s) => s.swapRaDec);
```
7. At the top of the `data` memo body (after the early `return null` guards, before `buildTraces` is called), add:
```ts
    const { ra: raColor, dec: decColor } = raDecColors(swapRaDec);
```
8. Update the `buildTraces` call (line ~729) to insert `raColor, decColor` between the `traceSnr` arg and `flipRaPulses`:
```ts
      traces: buildTraces(session, traces, scaleMode, yMax, coordMode, device, hasAo, themeOf(themeId).plot.traceMass, themeOf(themeId).plot.traceSnr, raColor, decColor, flipRaPulses, flipDecPulses, toX),
```
9. Update the `buildShapes` call (line ~730):
```ts
      shapes: buildShapes(session, mask, traces, scaleMode, toX, raColor, decColor),
```
10. Add `swapRaDec` to the `data` memo dependency array (currently ends `…, flipRaPulses, flipDecPulses]`).

- [ ] **Step 6: Verify build**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests still pass.

- [ ] **Step 7: Commit**

```bash
cd "z:/HomeLab-Repos/PHDLogViewer" && git add web/src/components/BurstChart.tsx web/src/components/SpikeChart.tsx web/src/components/SimpleSpikeChart.tsx web/src/components/ManualSpikeChart.tsx web/src/components/DriftChart.tsx web/src/components/ScatterView.tsx web/src/components/CalibrationPlot.tsx web/src/components/GuideGraph.tsx && git commit -F - <<'EOF'
feat: drive RA/Dec trace colors from the swapRaDec preference (item 5)

All eight RA/Dec-drawing charts now read swapRaDec and pick colors via
raDecColors(); the periodogram is untouched. No visual change until the
header toggle lands (default swap=false).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Item 5 (part 2) — header color-swap control

**Files:**
- Create: `web/src/components/RaDecColorPicker.tsx`
- Modify: `web/src/pages/ViewerPage.tsx`
- Modify: `web/src/i18n/locales/en/common.json`

- [ ] **Step 1: Add i18n keys**

In `web/src/i18n/locales/en/common.json`, add (next to the existing `theme` / `themeTooltip` keys):
```json
  "raDecColor": "RA/Dec colors",
  "raDecColorTooltip": "Swap the RA and Dec trace colors across all charts (except the periodogram).",
  "raDecColorNormal": "RA Blue / Dec Red",
  "raDecColorSwapped": "RA Red / Dec Blue",
```

- [ ] **Step 2: Create the picker**

Create `web/src/components/RaDecColorPicker.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useViewStore } from '../state/viewStore';

/**
 * Header dropdown that swaps the RA / Dec trace colors across every chart
 * except the periodogram. Native <select> to match ThemePicker (OS font
 * fallback, no shipped picker fonts). Writes the boolean `swapRaDec` to the
 * view store; charts read it and choose colors via `raDecColors()`.
 */
export function RaDecColorPicker() {
  const { t } = useTranslation('common');
  const swap = useViewStore((s) => s.swapRaDec);
  const setSwap = useViewStore((s) => s.setSwapRaDec);

  return (
    <label
      className="flex items-center gap-1 text-xs text-slate-400"
      title={t('raDecColorTooltip')}
    >
      <span className="sr-only">{t('raDecColor')}</span>
      <span aria-hidden>🔵🔴</span>
      <select
        aria-label={t('raDecColor')}
        value={swap ? 'swap' : 'normal'}
        onChange={(e) => setSwap(e.target.value === 'swap')}
        className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-xs text-slate-200 hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
      >
        <option value="normal">{t('raDecColorNormal')}</option>
        <option value="swap">{t('raDecColorSwapped')}</option>
      </select>
    </label>
  );
}
```

- [ ] **Step 3: Mount it next to the theme picker**

In `web/src/pages/ViewerPage.tsx`:
1. Add the import near the `ThemePicker` import:
```ts
import { RaDecColorPicker } from '../components/RaDecColorPicker';
```
2. Find the `<ThemePicker />` element in the header and add the new picker immediately before it:
```tsx
<RaDecColorPicker />
<ThemePicker />
```

- [ ] **Step 4: Verify build + behavior**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

Browser check: the header shows the 🔵🔴 dropdown next to the 🎨 theme picker. Selecting **RA Red / Dec Blue** instantly recolors RA/Dec on the guide graph, scatter, calibration plot, and the analysis drift + spike/manual/simple/burst charts; the **periodogram is unaffected**. Reload the page → the choice persists. Set it back to **RA Blue / Dec Red**.

- [ ] **Step 5: Commit**

```bash
cd "z:/HomeLab-Repos/PHDLogViewer" && git add web/src/components/RaDecColorPicker.tsx web/src/pages/ViewerPage.tsx web/src/i18n/locales/en/common.json && git commit -F - <<'EOF'
feat: header RA/Dec color-swap control (item 5)

Native-select picker beside the theme picker toggling swapRaDec
(RA Blue/Dec Red <-> RA Red/Dec Blue), persisted per-browser.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Final verification (after all tasks)

- [ ] `cd web && npx tsc --noEmit` — clean.
- [ ] `cd web && npx vitest run` — all green (existing 202 + new themes/perioPeaks tests).
- [ ] Browser regression on the sample log: drift chart clock axis; card Ratio/Ramp; periodogram hover Ratio; color swap across all non-periodogram charts + persistence.
- [ ] Per repo policy this is a coding feature, BUT the user asked to be able to roll back before this feature set — **hold the PR open after tests pass; do not auto-merge** until the user approves (see memory `feedback_evaluate_substantial_features`).

## Spec coverage check

- Item 4 (drift wall-clock) → Task 3. ✓
- Item 2 (Period Ratio, Raw-RA primary, both tabs) → Task 2 (`primaryPeriod`) + Task 4 (cards). ✓
- Item 3 (Ramp ×1000, 2 dp, follows scale) → Task 2 (`rampValue`) + Task 4 (cards). ✓
- Item 6 (Ratio in periodogram hover) → Task 4 (PeriodogramChart). ✓
- Item 5 (global swap, all charts except periodogram, header, persisted) → Task 1 (state+helper) + Task 5 (8 consumers) + Task 6 (UI). ✓
- Item 1 (dual amplitudes in hover) → already implemented; out of scope. ✓
