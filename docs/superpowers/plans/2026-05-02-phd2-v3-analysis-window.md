# PHD2 v3 Analysis Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the three currently-disabled "Analyze..." right-click menu items to a modal Analysis view containing a drift-corrected RA/Dec timeline + an FFT periodogram, matching the math and hover readouts of the desktop's `AnalysisWin`.

**Architecture:** Pure-TS port of `AnalysisWin.cpp::GARun::Analyze` (linear fit → drift-correct → spline-resample → Hamming → FFT) lives in `web/src/parser/analyze.ts`. A small Zustand store (`analysisStore`) tracks open/closed state. A full-screen `AnalysisModal` mounts at the page root and renders two Plotly charts (`DriftChart` + `PeriodogramChart`) reading from the store. Existing `GuideGraph.tsx` chart-gesture wiring is extracted into a reusable `useChartGestures` hook so the modal's charts pick up the same wheel/drag behavior.

**Tech Stack:** TypeScript, React 18, Zustand, Plotly.js (`scattergl`), [`fft.js`](https://www.npmjs.com/package/fft.js) for FFT, hand-rolled cubic spline. Vitest for unit + golden tests, Playwright for the e2e suite.

**Spec:** [docs/superpowers/specs/2026-05-02-phd2-v3-analysis-window-design.md](../specs/2026-05-02-phd2-v3-analysis-window-design.md)

---

## File Structure

```
web/
  src/
    parser/
      spline.ts                  # Task 1
      fft.ts                     # Task 2
      analyze.ts                 # Tasks 3-5
      __tests__/
        spline.test.ts           # Task 1
        fft.test.ts              # Task 2
        analyze.test.ts          # Tasks 3-5
        analyze.golden.test.ts   # Task 6
        fixtures/
          synthetic.log          # Modify: append a small unguided window (Task 6)
          synthetic.golden.json  # Modify: refresh expected counts (Task 6)
          analyze.golden.json    # NEW (Task 6)
    state/
      analysisStore.ts           # Task 7
    components/
      useChartGestures.ts        # Task 8 (extracted from GuideGraph.tsx)
      GuideGraph.tsx             # Task 8 (refactor to use the hook)
      DriftChart.tsx             # Task 9
      PeriodogramChart.tsx       # Task 10
      AnalysisModal.tsx          # Task 11
      ContextMenu.tsx            # Task 12 (wire up the three Analyze items)
    pages/
      ViewerPage.tsx             # Task 11 (mount the modal)
  e2e/
    analysis.spec.ts             # Task 13
  package.json                   # Task 2 (add fft.js dependency)
```

Note on naming: the spline class exposes `at(x)` rather than `eval(x)` — same numeric meaning, friendlier name, and avoids any confusion with `globalThis.eval`. Internal-only API.

---

### Task 1: Cubic spline (`spline.ts`)

**Files:**
- Create: `web/src/parser/spline.ts`
- Test: `web/src/parser/__tests__/spline.test.ts`

The spline is a small numerical building block used twice: (1) to resample the drift-corrected RA series onto a uniform grid before FFT, and (2) to draw a smooth FFT curve and snap the cursor to peaks. Natural-boundary cubic spline (matches GSL's default).

- [ ] **Step 1: Write failing tests**

```ts
// web/src/parser/__tests__/spline.test.ts
import { describe, it, expect } from 'vitest';
import { Spline } from '../spline';

describe('Spline', () => {
  it('passes through every input node exactly', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [0, 2, 1, 5, -1];
    const sp = new Spline(xs, ys);
    for (let i = 0; i < xs.length; i++) {
      expect(sp.at(xs[i])).toBeCloseTo(ys[i], 9);
    }
  });

  it('linearly interpolates a linear input within tight tolerance', () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const ys = xs.map((x) => 2 * x + 3); // y = 2x + 3
    const sp = new Spline(xs, ys);
    for (let t = 0; t <= 5; t += 0.1) {
      expect(sp.at(t)).toBeCloseTo(2 * t + 3, 6);
    }
  });

  it('clamps outside the domain to the boundary value', () => {
    const xs = [0, 1, 2];
    const ys = [10, 20, 30];
    const sp = new Spline(xs, ys);
    expect(sp.at(-5)).toBeCloseTo(10);
    expect(sp.at(99)).toBeCloseTo(30);
  });

  it('approximates a known cubic at midpoints', () => {
    // y = x^3
    const xs = [0, 1, 2, 3, 4, 5, 6];
    const ys = xs.map((x) => x * x * x);
    const sp = new Spline(xs, ys);
    expect(sp.at(2.5)).toBeCloseTo(2.5 ** 3, 1);
    expect(sp.at(3.5)).toBeCloseTo(3.5 ** 3, 1);
  });

  it('throws on non-monotonic x', () => {
    expect(() => new Spline([0, 2, 1], [0, 0, 0])).toThrow(/monotonic/i);
  });

  it('throws when x and y lengths differ', () => {
    expect(() => new Spline([0, 1], [0])).toThrow(/length/i);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd web && npm test -- spline`
Expected: FAIL with "module ../spline not found".

- [ ] **Step 3: Implement `web/src/parser/spline.ts`**

```ts
/**
 * Natural-boundary cubic spline interpolation.
 *
 * Used by the analysis pipeline (`analyze.ts`) for two purposes:
 *   1. Resample the drift-corrected RA signal onto a uniform time grid before
 *      FFT (matches `gsl_spline` use in AnalysisWin.cpp:366-375).
 *   2. Smoothly draw the periodogram and snap the cursor to local maxima
 *      (matches `GARun::ffts` use in AnalysisWin.cpp:408 / OnMove peak-snap).
 *
 * Natural boundary conditions match GSL's default `gsl_interp_cspline`.
 */
export class Spline {
  private readonly xs: number[];
  private readonly ys: number[];
  private readonly m: number[]; // second derivatives at each node

  constructor(xs: ArrayLike<number>, ys: ArrayLike<number>) {
    if (xs.length !== ys.length) throw new Error('Spline: x and y must be same length');
    if (xs.length < 2) throw new Error('Spline: need at least 2 points');
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] <= xs[i - 1]) throw new Error('Spline: x must be strictly monotonic increasing');
    }
    const n = xs.length;
    this.xs = Array.from(xs);
    this.ys = Array.from(ys);
    this.m = this.solveSecondDerivatives(n);
  }

  private solveSecondDerivatives(n: number): number[] {
    // Tridiagonal system for natural cubic spline second derivatives.
    // See e.g. Numerical Recipes §3.3.
    const m = new Array<number>(n).fill(0);
    if (n === 2) return m; // straight line, no curvature
    const a = new Array<number>(n).fill(0);
    const b = new Array<number>(n).fill(0);
    const c = new Array<number>(n).fill(0);
    const d = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const h0 = this.xs[i] - this.xs[i - 1];
      const h1 = this.xs[i + 1] - this.xs[i];
      a[i] = h0;
      b[i] = 2 * (h0 + h1);
      c[i] = h1;
      d[i] = 6 * ((this.ys[i + 1] - this.ys[i]) / h1 - (this.ys[i] - this.ys[i - 1]) / h0);
    }
    // Natural boundary: m[0] = m[n-1] = 0; solve interior with Thomas algorithm.
    for (let i = 2; i < n - 1; i++) {
      const w = a[i] / b[i - 1];
      b[i] -= w * c[i - 1];
      d[i] -= w * d[i - 1];
    }
    if (n - 2 >= 1) {
      m[n - 2] = d[n - 2] / b[n - 2];
      for (let i = n - 3; i >= 1; i--) {
        m[i] = (d[i] - c[i] * m[i + 1]) / b[i];
      }
    }
    return m;
  }

  /** Interpolated value at `x`. Clamps to the boundary value outside the domain. */
  at(x: number): number {
    const xs = this.xs;
    const n = xs.length;
    if (x <= xs[0]) return this.ys[0];
    if (x >= xs[n - 1]) return this.ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    const h = xs[hi] - xs[lo];
    const a = (xs[hi] - x) / h;
    const b = (x - xs[lo]) / h;
    return (
      a * this.ys[lo] +
      b * this.ys[hi] +
      ((a * a * a - a) * this.m[lo] + (b * b * b - b) * this.m[hi]) * (h * h) / 6
    );
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd web && npm test -- spline`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd web
git add src/parser/spline.ts src/parser/__tests__/spline.test.ts
git commit -m "Add natural cubic spline for analyze pipeline"
```

---

### Task 2: FFT wrapper (`fft.ts`)

**Files:**
- Modify: `web/package.json` (add `fft.js`)
- Create: `web/src/parser/fft.ts`
- Test: `web/src/parser/__tests__/fft.test.ts`

`fft.js` is a small (~20 kB) pure-JS forward FFT. We wrap it in a function with the exact signature `analyze.ts` will use, so the rest of the code never imports `fft.js` directly.

- [ ] **Step 1: Add `fft.js` dependency**

Edit `web/package.json`. In the `"dependencies"` block, add:

```json
"fft.js": "^4.0.4"
```

Then run:

```bash
cd web && npm install
```

- [ ] **Step 2: Write failing tests**

```ts
// web/src/parser/__tests__/fft.test.ts
import { describe, it, expect } from 'vitest';
import { forwardFftMagnitudes } from '../fft';

describe('forwardFftMagnitudes', () => {
  it('returns near-zero magnitudes for an all-zero signal', () => {
    const n = 64;
    const sig = new Float64Array(n);
    const mags = forwardFftMagnitudes(sig);
    expect(mags.length).toBe(n / 2);
    for (let i = 0; i < mags.length; i++) {
      expect(mags[i]).toBeLessThan(1e-12);
    }
  });

  it('peaks at the bin matching a clean sinusoid', () => {
    // Sinusoid with k=4 cycles over n=64 samples -> peak at bin 4.
    const n = 64;
    const k = 4;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) sig[i] = Math.cos((2 * Math.PI * k * i) / n);
    const mags = forwardFftMagnitudes(sig);
    let argmax = 0;
    for (let i = 1; i < mags.length; i++) if (mags[i] > mags[argmax]) argmax = i;
    expect(argmax).toBe(k);
  });

  it('throws when length is not a power of two', () => {
    expect(() => forwardFftMagnitudes(new Float64Array(5))).toThrow();
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `cd web && npm test -- fft`
Expected: FAIL with "module ../fft not found".

- [ ] **Step 4: Implement `web/src/parser/fft.ts`**

```ts
import FFTLib from 'fft.js';

interface FFTInstance {
  size: number;
  createComplexArray(): number[];
  realTransform(out: number[], data: ArrayLike<number>): void;
  completeSpectrum(out: number[]): void;
}
type FFTCtor = new (size: number) => FFTInstance;
const FFT = FFTLib as unknown as FFTCtor;

/**
 * Forward real FFT. Returns the magnitude (|z|) of each non-redundant bin
 * (length n/2). The caller is responsible for choosing how to convert bin
 * indices to (period, amplitude) — see `analyze.ts` for the periodogram-
 * scaling convention used by the desktop app (AnalysisWin.cpp:393).
 *
 * `fft.js` requires the input length to be a power of two — the analyze
 * pipeline ensures this by rounding the resampled signal up to the next
 * power of two and zero-padding (see analyze.ts).
 */
export function forwardFftMagnitudes(signal: ArrayLike<number>): Float64Array {
  const n = signal.length;
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`forwardFftMagnitudes: length ${n} is not a power of two ≥ 2`);
  }
  const fft = new FFT(n);
  const out = fft.createComplexArray();
  fft.realTransform(out, signal);
  // After realTransform, the first n/2 complex pairs are populated; the
  // rest is the conjugate spectrum we don't need.
  const mags = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    const re = out[2 * i];
    const im = out[2 * i + 1];
    mags[i] = Math.hypot(re, im);
  }
  return mags;
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `cd web && npm test -- fft`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd web
git add package.json package-lock.json src/parser/fft.ts src/parser/__tests__/fft.test.ts
git commit -m "Add fft.js wrapper for analyze pipeline"
```

---

### Task 3: `findUnguidedWindow` and `canAnalyze`

**Files:**
- Create: `web/src/parser/analyze.ts` (start)
- Test: `web/src/parser/__tests__/analyze.test.ts` (start)

Builds the gating predicates without yet running the math. Done first so subsequent tasks can rely on them.

- [ ] **Step 1: Write failing tests**

```ts
// web/src/parser/__tests__/analyze.test.ts
import { describe, it, expect } from 'vitest';
import { canAnalyze, findUnguidedWindow } from '../analyze';
import { newGuideSession } from '../types';
import type { GuideEntry } from '../types';

const mkE = (frame: number, dt: number, included = true, guiding = true): GuideEntry => ({
  frame, dt, mount: 'MOUNT', included, guiding,
  dx: 0, dy: 0, raraw: 0, decraw: 0, raguide: 0, decguide: 0,
  radur: 0, decdur: 0, mass: 0, snr: 20, err: 0, info: '',
});

describe('canAnalyze', () => {
  it('returns false for a session with fewer than 12 valid entries', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 10 }, (_, i) => mkE(i + 1, i + 1));
    expect(canAnalyze(s, { range: { begin: 0, end: 10 }, undoRaCorrections: false })).toBe(false);
  });

  it('returns true once 12 entries pass the filter', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 12 }, (_, i) => mkE(i + 1, i + 1));
    expect(canAnalyze(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false })).toBe(true);
  });

  it('honors the user mask when counting', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 13 }, (_, i) => mkE(i + 1, i + 1));
    const mask = new Uint8Array(13);
    mask[0] = 1;
    mask[1] = 1;
    expect(canAnalyze(s, { range: { begin: 0, end: 13 }, undoRaCorrections: false, mask })).toBe(false);
  });

  it('skips entries that the parser flagged as not-included', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 13 }, (_, i) => mkE(i + 1, i + 1, i > 0));
    expect(canAnalyze(s, { range: { begin: 0, end: 13 }, undoRaCorrections: false })).toBe(true);
    s.entries[5].included = false;
    s.entries[6].included = false;
    expect(canAnalyze(s, { range: { begin: 0, end: 13 }, undoRaCorrections: false })).toBe(false);
  });
});

describe('findUnguidedWindow', () => {
  it('returns null when every entry was guided', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 5 }, (_, i) => mkE(i + 1, i + 1, true, true));
    expect(findUnguidedWindow(s)).toBeNull();
  });

  it('finds the first contiguous unguided run', () => {
    const s = newGuideSession('x');
    s.entries = [
      mkE(1, 1, true, true),
      mkE(2, 2, true, false),
      mkE(3, 3, true, false),
      mkE(4, 4, true, false),
      mkE(5, 5, true, true),
      mkE(6, 6, true, false),
    ];
    expect(findUnguidedWindow(s)).toEqual({ begin: 1, end: 3 });
  });

  it('finds the run starting at index 0 when the session opens unguided', () => {
    const s = newGuideSession('x');
    s.entries = [
      mkE(1, 1, true, false),
      mkE(2, 2, true, false),
      mkE(3, 3, true, true),
    ];
    expect(findUnguidedWindow(s)).toEqual({ begin: 0, end: 1 });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd web && npm test -- analyze`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gating part of `web/src/parser/analyze.ts`**

```ts
import type { GuideSession } from './types';

const MIN_ENTRIES = 12; // matches AnalysisWin.cpp:273

export interface AnalyzeOptions {
  range: { begin: number; end: number };
  undoRaCorrections: boolean;
  mask?: Uint8Array;
}

const isUsable = (
  s: GuideSession,
  i: number,
  mask: Uint8Array | undefined,
): boolean => {
  const e = s.entries[i];
  // The parser already enforces `included = StarWasFound(err)`; mirror the
  // desktop's `Include` predicate (AnalysisWin.cpp:88) and add the user's
  // exclusion mask which our app keeps separate.
  if (!e.included) return false;
  return !mask || mask[i] !== 1;
};

export function canAnalyze(s: GuideSession, opts: AnalyzeOptions): boolean {
  const { range, mask } = opts;
  let n = 0;
  for (let i = range.begin; i < range.end && i < s.entries.length; i++) {
    if (isUsable(s, i, mask) && ++n >= MIN_ENTRIES) return true;
  }
  return false;
}

/**
 * The first contiguous run of `guiding === false` entries (Guiding Assistant).
 * Returns indices `[begin, end]` inclusive, or null if every entry was guided.
 */
export function findUnguidedWindow(s: GuideSession): { begin: number; end: number } | null {
  let begin = -1;
  for (let i = 0; i < s.entries.length; i++) {
    if (!s.entries[i].guiding) {
      if (begin < 0) begin = i;
    } else if (begin >= 0) {
      return { begin, end: i - 1 };
    }
  }
  if (begin >= 0) return { begin, end: s.entries.length - 1 };
  return null;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd web && npm test -- analyze`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd web
git add src/parser/analyze.ts src/parser/__tests__/analyze.test.ts
git commit -m "Add canAnalyze and findUnguidedWindow gating predicates"
```

---

### Task 4: Drift fit (`analyze.ts`, drift portion)

**Files:**
- Modify: `web/src/parser/analyze.ts` (add drift fit)
- Modify: `web/src/parser/__tests__/analyze.test.ts` (append tests)

Builds the linear fit + drift-correction step. Standalone test before adding the FFT.

- [ ] **Step 1: Append drift-fit tests**

Add to `web/src/parser/__tests__/analyze.test.ts`:

```ts
import { computeDriftCorrected } from '../analyze';

describe('computeDriftCorrected', () => {
  it('recovers the slope of a clean linear ramp', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 60 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      decraw: 0.5 * (i + 1),
    }));
    const out = computeDriftCorrected(s, { range: { begin: 0, end: 60 }, undoRaCorrections: false });
    expect(out.driftDec).toBeCloseTo(0.5, 6);
    for (const v of out.decc) expect(Math.abs(v)).toBeLessThan(1e-6);
  });

  it('integrates accumulated RA position from per-frame moves', () => {
    const s = newGuideSession('x');
    s.entries = [
      { ...mkE(1, 1), raraw: 0, raguide: 0 },
      { ...mkE(2, 2), raraw: 0.3, raguide: 0 },
      { ...mkE(3, 3), raraw: 0.6, raguide: 0 },
      ...Array.from({ length: 9 }, (_, i) => ({ ...mkE(i + 4, i + 4), raraw: 0.6, raguide: 0 })),
    ];
    const out = computeDriftCorrected(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false });
    expect(out.rac.length).toBe(12);
    for (const v of out.rac) expect(Number.isFinite(v)).toBe(true);
  });

  it('undoRaCorrections changes the effective rapos when raguide is non-zero', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 12 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      raraw: 0,
      raguide: 0.1,
    }));
    const off = computeDriftCorrected(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false });
    const on = computeDriftCorrected(s, { range: { begin: 0, end: 12 }, undoRaCorrections: true });
    expect(Math.abs(off.driftRa)).toBeLessThan(1e-6);
    expect(Math.abs(on.driftRa)).toBeGreaterThan(0.05);
  });

  it('honors the user mask in the drift fit', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 12 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      decraw: i === 11 ? 1000 : 0,
    }));
    const mask = new Uint8Array(12);
    mask[11] = 1;
    const out = computeDriftCorrected(s, { range: { begin: 0, end: 12 }, undoRaCorrections: false, mask });
    expect(Math.abs(out.driftDec)).toBeLessThan(1e-6);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd web && npm test -- analyze`
Expected: FAIL — `computeDriftCorrected` not exported.

- [ ] **Step 3: Implement drift-fit portion in `web/src/parser/analyze.ts`**

Append below the existing exports:

```ts
export interface DriftCorrected {
  /** Filtered timestamps (seconds) of every used entry, in order. */
  t: Float64Array;
  /** Drift-corrected RA position. */
  rac: Float64Array;
  /** Drift-corrected Dec. */
  decc: Float64Array;
  /** RA position drift slope (units per second). */
  driftRa: number;
  /** Dec drift slope (units per second). */
  driftDec: number;
}

interface LFit {
  n: number;
  sx: number; sy: number; sxx: number; sxy: number;
}
const newLFit = (): LFit => ({ n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 });
const lfitAdd = (f: LFit, x: number, y: number) => {
  f.n++; f.sx += x; f.sy += y; f.sxx += x * x; f.sxy += x * y;
};
const lfitLine = (f: LFit): { slope: number; intercept: number } => {
  if (f.n < 2) return { slope: 0, intercept: f.n === 1 ? f.sy : 0 };
  const denom = f.n * f.sxx - f.sx * f.sx;
  if (denom === 0) return { slope: 0, intercept: f.sy / f.n };
  const slope = (f.n * f.sxy - f.sx * f.sy) / denom;
  const intercept = (f.sy - slope * f.sx) / f.n;
  return { slope, intercept };
};

/**
 * Step 1-3 of `GARun::Analyze` (AnalysisWin.cpp:283-356):
 *   - Build accumulated RA position by integrating per-frame raw moves
 *     (optionally re-adding the RA correction to show what tracking would
 *     have looked like unguided).
 *   - Linear-fit (RA, Dec) vs. time.
 *   - Subtract the fit -> drift-corrected series.
 *
 * Honors the user-supplied exclusion mask in addition to the parser's
 * `entry.included` flag.
 */
export function computeDriftCorrected(s: GuideSession, opts: AnalyzeOptions): DriftCorrected {
  const { range, mask, undoRaCorrections } = opts;
  let n = 0;
  for (let i = range.begin; i < range.end && i < s.entries.length; i++) {
    if (isUsable(s, i, mask)) n++;
  }
  const t = new Float64Array(n);
  const ra = new Float64Array(n);
  const dec = new Float64Array(n);

  const fitR = newLFit();
  const fitD = newLFit();

  let rapos = 0;
  let prevRaguide = 0;
  let prevRaraw = 0;
  let k = 0;
  for (let i = range.begin; i < range.end && i < s.entries.length; i++) {
    if (!isUsable(s, i, mask)) continue;
    const e = s.entries[i];
    const raraw = e.raraw;
    const raguide = e.raguide;
    const move = raraw - prevRaraw - prevRaguide;
    rapos += move;
    prevRaraw = raraw;
    prevRaguide = undoRaCorrections ? raguide : 0;
    t[k] = e.dt;
    ra[k] = rapos;
    dec[k] = e.decraw;
    lfitAdd(fitR, e.dt, rapos);
    lfitAdd(fitD, e.dt, e.decraw);
    k++;
  }

  const lineR = lfitLine(fitR);
  const lineD = lfitLine(fitD);
  const rac = new Float64Array(n);
  const decc = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rac[i] = ra[i] - (lineR.slope * t[i] + lineR.intercept);
    decc[i] = dec[i] - (lineD.slope * t[i] + lineD.intercept);
  }
  return { t, rac, decc, driftRa: lineR.slope, driftDec: lineD.slope };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd web && npm test -- analyze`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
cd web
git add src/parser/analyze.ts src/parser/__tests__/analyze.test.ts
git commit -m "Add drift-corrected RA/Dec computation"
```

---

### Task 5: FFT pipeline (`analyze.ts`, full `analyze`)

**Files:**
- Modify: `web/src/parser/analyze.ts` (add full `analyze`)
- Modify: `web/src/parser/__tests__/analyze.test.ts` (append tests)

Resamples to a uniform grid via `Spline`, applies a Hamming window, runs `forwardFftMagnitudes`, converts bins to (period, amplitude). Returns a `GARun`.

- [ ] **Step 1: Append FFT-pipeline tests**

```ts
import { analyze } from '../analyze';

describe('analyze (full pipeline)', () => {
  it('recovers a known sinusoid period and approximate amplitude', () => {
    const s = newGuideSession('x');
    s.pixelScale = 1;
    s.entries = Array.from({ length: 256 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      raraw: Math.cos((2 * Math.PI * (i + 1)) / 30),
    }));
    const ga = analyze(s, { range: { begin: 0, end: 256 }, undoRaCorrections: false });
    let imax = 0;
    for (let i = 1; i < ga.fftAmplitude.length; i++) {
      if (ga.fftAmplitude[i] > ga.fftAmplitude[imax]) imax = i;
    }
    const peakPeriod = ga.fftPeriod[imax];
    expect(peakPeriod).toBeGreaterThan(28);
    expect(peakPeriod).toBeLessThan(32);
    expect(ga.fftAmplitude[imax]).toBeGreaterThan(0.3);
    expect(ga.fftAmplitude[imax]).toBeLessThan(2.0);
  });

  it('produces fftPeriod sorted ascending and skips DC', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 64 }, (_, i) => ({
      ...mkE(i + 1, i + 1),
      raraw: Math.sin(i * 0.4),
    }));
    const ga = analyze(s, { range: { begin: 0, end: 64 }, undoRaCorrections: false });
    expect(ga.fftPeriod.length).toBe(ga.fftAmplitude.length);
    expect(ga.fftPeriod.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < ga.fftPeriod.length; i++) {
      expect(ga.fftPeriod[i]).toBeGreaterThanOrEqual(ga.fftPeriod[i - 1]);
    }
    for (const p of ga.fftPeriod) expect(Number.isFinite(p)).toBe(true);
  });

  it('attaches the requested undoRaCorrections flag and the session pixelScale', () => {
    const s = newGuideSession('x');
    s.pixelScale = 1.7;
    s.entries = Array.from({ length: 32 }, (_, i) => mkE(i + 1, i + 1));
    const ga = analyze(s, { range: { begin: 0, end: 32 }, undoRaCorrections: true });
    expect(ga.undoRaCorrections).toBe(true);
    expect(ga.pixelScale).toBeCloseTo(1.7);
    expect(ga.range).toEqual({ begin: 0, end: 32 });
  });

  it('throws when not enough entries are usable', () => {
    const s = newGuideSession('x');
    s.entries = Array.from({ length: 5 }, (_, i) => mkE(i + 1, i + 1));
    expect(() => analyze(s, { range: { begin: 0, end: 5 }, undoRaCorrections: false }))
      .toThrow(/at least 12/i);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd web && npm test -- analyze`
Expected: FAIL — `analyze` not exported yet.

- [ ] **Step 3: Implement the full `analyze` in `web/src/parser/analyze.ts`**

Append at the bottom:

```ts
import { Spline } from './spline';
import { forwardFftMagnitudes } from './fft';

export interface GARun {
  starts: number | null;
  pixelScale: number;
  range: { begin: number; end: number };
  undoRaCorrections: boolean;
  driftRa: number;
  driftDec: number;
  t: Float64Array;
  rac: Float64Array;
  decc: Float64Array;
  fftPeriod: Float64Array;
  fftAmplitude: Float64Array;
  fftAmpMax: number;
  fftSpline: Spline;
}

const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

/**
 * Full GARun port. Equivalent to AnalysisWin.cpp:283-411.
 *
 *   1. computeDriftCorrected → (t, rac, decc, driftRa, driftDec)
 *   2. Spline-resample rac onto a uniform grid of length n
 *      (rounded up to the next power of two so the FFT can run; the C++
 *      code uses an arbitrary-N GSL FFT, but `fft.js` requires p2)
 *   3. Apply a Hamming window
 *   4. forwardFftMagnitudes → bin magnitudes
 *   5. Convert bins to (period, amplitude); skip DC; sort ascending by
 *      period; build a smoothing spline
 */
export function analyze(s: GuideSession, opts: AnalyzeOptions): GARun {
  if (!canAnalyze(s, opts)) {
    throw new Error('analyze: need at least 12 usable entries; canAnalyze returned false');
  }
  const drift = computeDriftCorrected(s, opts);
  const n0 = drift.t.length;
  const dt = (drift.t[n0 - 1] - drift.t[0]) / (n0 - 1);
  const n = nextPow2(n0);

  const sp = new Spline(Array.from(drift.t), Array.from(drift.rac));
  const sig = new Float64Array(n);
  const k = (Math.PI * 2) / (n0 - 1);
  for (let i = 0; i < n0; i++) {
    let x = drift.t[0] + i * dt;
    if (x > drift.t[n0 - 1]) x = drift.t[n0 - 1];
    const hw = 0.54 - 0.46 * Math.cos(i * k);
    sig[i] = hw * sp.at(x);
  }
  // sig[n0..n-1] stays at zero (Float64Array default), serving as zero-pad.

  const mags = forwardFftMagnitudes(sig);
  // AnalysisWin.cpp:393 — periodogram amplitude scaling. Use n0 (the count of
  // populated samples) rather than n so the amplitude reflects the actual
  // signal energy, not the padded length.
  const scale = 4 / n0;
  const nfft = n / 2 - 1;
  const period = new Float64Array(nfft);
  const amplitude = new Float64Array(nfft);
  let amax = 0;
  for (let i = 0; i < nfft; i++) {
    const f = (i + 1) / (n * dt);
    const p = 1 / f;
    const a = mags[i + 1] * scale;
    // Reverse-write so periods land in ascending order (longest period first
    // would otherwise be index 0). Matches the C++ ordering at
    // AnalysisWin.cpp:401-403.
    period[nfft - 1 - i] = p;
    amplitude[nfft - 1 - i] = a;
    if (a > amax) amax = a;
  }
  const spline = new Spline(Array.from(period), Array.from(amplitude));

  return {
    starts: s.startsMs,
    pixelScale: s.pixelScale,
    range: { begin: opts.range.begin, end: opts.range.end },
    undoRaCorrections: opts.undoRaCorrections,
    driftRa: drift.driftRa,
    driftDec: drift.driftDec,
    t: drift.t,
    rac: drift.rac,
    decc: drift.decc,
    fftPeriod: period,
    fftAmplitude: amplitude,
    fftAmpMax: amax,
    fftSpline: spline,
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd web && npm test -- analyze`
Expected: PASS (15 tests total).

- [ ] **Step 5: Commit**

```bash
cd web
git add src/parser/analyze.ts src/parser/__tests__/analyze.test.ts
git commit -m "Add full analyze() pipeline with FFT and periodogram"
```

---

### Task 6: Synthetic fixture update + golden test

**Files:**
- Modify: `web/src/parser/__tests__/fixtures/synthetic.log` (append unguided window)
- Modify: `web/src/parser/__tests__/fixtures/synthetic.golden.json` (refresh counts)
- Create: `web/src/parser/__tests__/fixtures/analyze.golden.json`
- Create: `web/src/parser/__tests__/analyze.golden.test.ts`

Locks the analyze pipeline against regressions and exercises the unguided-window code path.

- [ ] **Step 1: Inspect the current synthetic log and its golden**

Run:

```bash
cd web && cat src/parser/__tests__/fixtures/synthetic.log | tail -20
cat src/parser/__tests__/fixtures/synthetic.golden.json
```

Note the current ending and the entry counts.

- [ ] **Step 2: Append a small unguided window to the synthetic log**

Open `web/src/parser/__tests__/fixtures/synthetic.log`. Find the line `5,5.000,"Mount",-0.10,...`. Insert BEFORE the `Guiding Ends at ...` line:

```
INFO: MountGuidingEnabled = false
6,6.000,"Mount",-0.20,0.10,-0.20,0.10,0.00,0.00,0,E,0,N,,,1500,15.5,0
7,7.000,"Mount",-0.30,0.12,-0.30,0.12,0.00,0.00,0,E,0,N,,,1500,15.5,0
8,8.000,"Mount",-0.40,0.15,-0.40,0.15,0.00,0.00,0,E,0,N,,,1500,15.5,0
INFO: MountGuidingEnabled = true
9,9.000,"Mount",-0.05,0.05,-0.05,0.05,0.00,0.00,50,W,50,S,,,1500,15.5,0
```

- [ ] **Step 3: Refresh `synthetic.golden.json` and `parseLog.test.ts` to match**

The existing golden test (`web/src/parser/__tests__/golden.test.ts`) and the parseLog tests assert specific entry/info counts. Re-run them:

Run: `cd web && npm test -- parseLog golden`
Expected: FAIL with diffs in entry counts.

Update each failing assertion in `web/src/parser/__tests__/parseLog.test.ts` and the JSON in `web/src/parser/__tests__/fixtures/synthetic.golden.json` to reflect the actual parser output (9 entries, the new info count, etc.). Re-run until clean.

- [ ] **Step 4: Create `web/src/parser/__tests__/fixtures/analyze.golden.json`**

```json
{
  "note": "Snapshot of analyze() output on synthetic.log. Re-bake by deleting and re-running the suite — the test writes a fresh snapshot on first run.",
  "len": null,
  "nfft": null,
  "fftAmpMax": null,
  "driftRa": null,
  "driftDec": null,
  "fftPeriodFirst": null,
  "fftPeriodLast": null
}
```

- [ ] **Step 5: Write the golden test that auto-fills the snapshot on first run**

Create `web/src/parser/__tests__/analyze.golden.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLog } from '../parseLog';
import { analyze } from '../analyze';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, 'fixtures', 'synthetic.log');
const SNAP = join(__dirname, 'fixtures', 'analyze.golden.json');

describe('analyze golden', () => {
  it('matches the locked snapshot for synthetic.log', () => {
    const text = readFileSync(LOG, 'utf-8');
    const log = parseLog(text);
    const session = log.sessions[0];
    const ga = analyze(session, { range: { begin: 0, end: session.entries.length }, undoRaCorrections: false });
    const summary = {
      len: ga.t.length,
      nfft: ga.fftPeriod.length,
      fftAmpMax: ga.fftAmpMax,
      driftRa: ga.driftRa,
      driftDec: ga.driftDec,
      fftPeriodFirst: ga.fftPeriod[0],
      fftPeriodLast: ga.fftPeriod[ga.fftPeriod.length - 1],
    };
    if (!existsSync(SNAP) || JSON.parse(readFileSync(SNAP, 'utf-8')).len === null) {
      writeFileSync(SNAP, JSON.stringify(summary, null, 2));
      return; // first run — skip the equality check
    }
    const expected = JSON.parse(readFileSync(SNAP, 'utf-8'));
    expect(summary.len).toBe(expected.len);
    expect(summary.nfft).toBe(expected.nfft);
    expect(summary.fftAmpMax).toBeCloseTo(expected.fftAmpMax, 6);
    expect(summary.driftRa).toBeCloseTo(expected.driftRa, 6);
    expect(summary.driftDec).toBeCloseTo(expected.driftDec, 6);
    expect(summary.fftPeriodFirst).toBeCloseTo(expected.fftPeriodFirst, 6);
    expect(summary.fftPeriodLast).toBeCloseTo(expected.fftPeriodLast, 6);
  });
});
```

- [ ] **Step 6: Run the golden test once to fill in the snapshot**

Run: `cd web && npm test -- analyze.golden`
Expected: PASS — the test writes the snapshot on first run and returns early. Open `analyze.golden.json` and verify all fields are populated with finite numbers.

Re-run to confirm the second invocation hits the equality assertions:

Run: `cd web && npm test -- analyze.golden`
Expected: PASS.

- [ ] **Step 7: Run the full unit suite to confirm nothing else broke**

Run: `cd web && npm test`
Expected: PASS for every spec.

- [ ] **Step 8: Commit**

```bash
cd web
git add src/parser/__tests__/fixtures/synthetic.log
git add src/parser/__tests__/fixtures/synthetic.golden.json
git add src/parser/__tests__/fixtures/analyze.golden.json
git add src/parser/__tests__/analyze.golden.test.ts
git add src/parser/__tests__/parseLog.test.ts
git commit -m "Extend synthetic log with unguided window + analyze golden snapshot"
```

---

### Task 7: `analysisStore` (state)

**Files:**
- Create: `web/src/state/analysisStore.ts`

A small Zustand store with two states (closed / open) and the toolbar overrides for the modal.

- [ ] **Step 1: Implement `web/src/state/analysisStore.ts`**

```ts
import { create } from 'zustand';
import type { GARun } from '../parser/analyze';

export type AnalysisKind = 'all' | 'all-raw-ra' | 'unguided';

interface ClosedState {
  state: 'closed';
}

interface OpenState {
  state: 'open';
  garun: GARun;
  kind: AnalysisKind;
  showRa: boolean;
  showDec: boolean;
  /** Modal-local override of the global scale mode. */
  scaleMode: 'PIXELS' | 'ARCSEC';
}

type AnalysisStateUnion = ClosedState | OpenState;

interface Actions {
  open: (p: { garun: GARun; kind: AnalysisKind; initialScaleMode: 'PIXELS' | 'ARCSEC' }) => void;
  close: () => void;
  setShowRa: (b: boolean) => void;
  setShowDec: (b: boolean) => void;
  setScaleMode: (m: 'PIXELS' | 'ARCSEC') => void;
}

/**
 * Tracks whether the Analysis modal is open and what GARun result it's
 * showing. Not persisted — closing forgets the state. Modal toolbar
 * controls (showRa, showDec, scaleMode) live here so reopening the modal
 * starts from the global defaults again.
 */
export const useAnalysisStore = create<AnalysisStateUnion & Actions>((set) => ({
  state: 'closed',
  open: ({ garun, kind, initialScaleMode }) =>
    set({
      state: 'open',
      garun,
      kind,
      showRa: true,
      showDec: true,
      scaleMode: initialScaleMode,
    } as OpenState),
  close: () => set({ state: 'closed' } as ClosedState),
  setShowRa: (b) => set((s) => (s.state === 'open' ? { ...s, showRa: b } : s)),
  setShowDec: (b) => set((s) => (s.state === 'open' ? { ...s, showDec: b } : s)),
  setScaleMode: (m) => set((s) => (s.state === 'open' ? { ...s, scaleMode: m } : s)),
}));
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd web
git add src/state/analysisStore.ts
git commit -m "Add analysisStore for modal state"
```

---

### Task 8: Extract `useChartGestures` hook

**Files:**
- Create: `web/src/components/useChartGestures.ts`
- Modify: `web/src/components/GuideGraph.tsx` (use the hook)

Pulls the wheel/drag/Y-zoom wiring out of `GuideGraph` so the modal's two charts can reuse it. Behavior unchanged; verified by the existing per-section memory e2e test.

- [ ] **Step 1: Read the current drag/wheel logic in `GuideGraph.tsx`**

Run: `cd web && grep -n "useEffect\|onWheel\|sectionViews\|lockedYView" src/components/GuideGraph.tsx`

Identify the big `useEffect` block (it has the comment `// All custom drag gestures (Y zoom + X pan, include/exclude).`). The hook needs to encapsulate that block.

- [ ] **Step 2: Create `web/src/components/useChartGestures.ts`**

```tsx
import { useEffect } from 'react';
// @ts-expect-error -- no types for the dist bundle; we only call relayout.
import Plotly from 'plotly.js/dist/plotly';

interface PlotDiv extends HTMLDivElement {
  _fullLayout?: {
    xaxis?: { _offset: number; _length: number; range: [number, number] };
    yaxis?: { _offset: number; _length: number; range: [number, number] };
  };
}

const INCLUDE_FILL = 'rgba(34, 197, 94, 0.18)';
const INCLUDE_BORDER = 'rgba(34, 197, 94, 0.7)';
const EXCLUDE_FILL = 'rgba(251, 146, 60, 0.18)';
const EXCLUDE_BORDER = 'rgba(251, 146, 60, 0.7)';

export interface ChartGestureCallbacks {
  /** Called when the user shift-drags a horizontal range. Frames passed are mount-frame numbers. */
  onIncludeRange?: (frameLo: number, frameHi: number) => void;
  /** Called when the user ctrl/cmd-drags a horizontal range. */
  onExcludeRange?: (frameLo: number, frameHi: number) => void;
  /** Called whenever the X or Y range changes (drag-pan, Y-zoom). */
  onRangeChange?: (axis: 'x' | 'y', range: [number, number]) => void;
  /** Provides frames + dt-mapping for the include/exclude callbacks. */
  rangeContext?: () => { frames: number[]; dts: number[] } | null;
}

export interface ChartGestureOptions {
  enableModifierSelect?: boolean; // default true
  hideRangeSliderDuringDrag?: boolean; // default false
}

/**
 * Drag-driven chart gestures shared between the main GuideGraph and the
 * Analysis modal's two charts:
 *   - Plain drag = X pan + continuous Y zoom anchored on the cursor's data Y.
 *   - Shift+drag = horizontal include selection (callback only).
 *   - Ctrl/Cmd+drag = horizontal exclude selection (callback only).
 *   - Wheel zoom is provided by Plotly's built-in scrollZoom; not handled here.
 *
 * rAF-throttles relayouts and (optionally) hides an attached rangeslider
 * during the drag for performance.
 */
export function useChartGestures(
  plotId: string,
  callbacks: ChartGestureCallbacks,
  opts: ChartGestureOptions = {},
) {
  const enableModifierSelect = opts.enableModifierSelect ?? true;
  const hideSlider = opts.hideRangeSliderDuringDrag ?? false;

  useEffect(() => {
    const div = document.getElementById(plotId) as PlotDiv | null;
    if (!div) return;
    div.style.position = 'relative';

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:absolute',
      'top:0',
      'bottom:0',
      'pointer-events:none',
      'display:none',
      'z-index:5',
      'border-style:solid',
      'border-width:1px',
    ].join(';');
    div.appendChild(overlay);

    const isInPlotArea = (e: MouseEvent): boolean => {
      const t = e.target as HTMLElement | null;
      return !!t?.closest('.nsewdrag, .bglayer, .draglayer');
    };

    let rafId: number | null = null;
    let pendingPatch: Record<string, [number, number]> | null = null;
    const queueRelayout = (patch: Record<string, [number, number]>) => {
      pendingPatch = pendingPatch ? { ...pendingPatch, ...patch } : { ...patch };
      if (rafId == null) {
        rafId = requestAnimationFrame(() => {
          if (pendingPatch) void Plotly.relayout(plotId, pendingPatch);
          pendingPatch = null;
          rafId = null;
        });
      }
    };

    type DragKind = 'PAN_ZOOM' | 'X_INCLUDE' | 'X_EXCLUDE' | null;
    let kind: DragKind = null;
    let startClientX = 0;
    let startClientY = 0;
    let startYRange: [number, number] = [0, 0];
    let startXRange: [number, number] = [0, 0];
    let yAnchor = 0;
    let yAnchorFrac = 0.5;
    let xStartFrac = 0;
    let sliderHidden = false;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!isInPlotArea(e)) return;
      const xa = div._fullLayout?.xaxis;
      const ya = div._fullLayout?.yaxis;
      if (!xa || !ya) return;
      const rect = div.getBoundingClientRect();

      if (enableModifierSelect && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        kind = e.shiftKey ? 'X_INCLUDE' : 'X_EXCLUDE';
        const px = e.clientX - rect.left - xa._offset;
        xStartFrac = Math.min(1, Math.max(0, px / xa._length));
        const isInclude = kind === 'X_INCLUDE';
        overlay.style.display = 'block';
        overlay.style.left = (xa._offset + xStartFrac * xa._length) + 'px';
        overlay.style.width = '0px';
        overlay.style.background = isInclude ? INCLUDE_FILL : EXCLUDE_FILL;
        overlay.style.borderColor = isInclude ? INCLUDE_BORDER : EXCLUDE_BORDER;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      kind = 'PAN_ZOOM';
      const py = e.clientY - rect.top - ya._offset;
      const frac = Math.min(1, Math.max(0, 1 - py / ya._length));
      const [y0, y1] = ya.range;
      yAnchor = y0 + frac * (y1 - y0);
      yAnchorFrac = frac;
      startClientX = e.clientX;
      startClientY = e.clientY;
      startYRange = [y0, y1];
      startXRange = [...xa.range] as [number, number];
      if (hideSlider) {
        void Plotly.relayout(plotId, { 'xaxis.rangeslider.visible': false });
        sliderHidden = true;
      }
      e.preventDefault();
    };

    const onMove = (e: MouseEvent) => {
      if (!kind) return;
      const xa = div._fullLayout?.xaxis;
      if (!xa) return;
      if (kind === 'PAN_ZOOM') {
        const dy = e.clientY - startClientY;
        const factor = Math.exp(dy / 200);
        const oldYSpan = startYRange[1] - startYRange[0];
        const newYSpan = oldYSpan * factor;
        const newY0 = yAnchor - yAnchorFrac * newYSpan;
        const newY1 = newY0 + newYSpan;
        const dx = e.clientX - startClientX;
        const xSpan = startXRange[1] - startXRange[0];
        const dxData = (dx / xa._length) * xSpan;
        const newX0 = startXRange[0] - dxData;
        const newX1 = startXRange[1] - dxData;
        queueRelayout({
          'yaxis.range': [newY0, newY1],
          'xaxis.range': [newX0, newX1],
        });
        callbacks.onRangeChange?.('x', [newX0, newX1]);
        callbacks.onRangeChange?.('y', [newY0, newY1]);
        return;
      }
      const rect = div.getBoundingClientRect();
      const curPx = e.clientX - rect.left - xa._offset;
      const curFrac = Math.min(1, Math.max(0, curPx / xa._length));
      const a = Math.min(xStartFrac, curFrac);
      const b = Math.max(xStartFrac, curFrac);
      overlay.style.left = (xa._offset + a * xa._length) + 'px';
      overlay.style.width = ((b - a) * xa._length) + 'px';
    };

    const onUp = (e: MouseEvent) => {
      if (!kind) return;
      const xa = div._fullLayout?.xaxis;

      if (kind !== 'PAN_ZOOM' && xa && callbacks.rangeContext) {
        overlay.style.display = 'none';
        const rect = div.getBoundingClientRect();
        const endPx = e.clientX - rect.left - xa._offset;
        const endFrac = Math.min(1, Math.max(0, endPx / xa._length));
        const a = Math.min(xStartFrac, endFrac);
        const b = Math.max(xStartFrac, endFrac);
        if (b - a >= 0.005) {
          const [x0, x1] = xa.range;
          const tA = x0 + a * (x1 - x0);
          const tB = x0 + b * (x1 - x0);
          const ctx = callbacks.rangeContext();
          if (ctx) {
            let firstFrame = -1, lastFrame = -1;
            for (let i = 0; i < ctx.dts.length; i++) {
              if (ctx.dts[i] >= tA && ctx.dts[i] <= tB) {
                if (firstFrame < 0) firstFrame = ctx.frames[i];
                lastFrame = ctx.frames[i];
              }
            }
            if (firstFrame >= 0) {
              if (kind === 'X_INCLUDE') callbacks.onIncludeRange?.(firstFrame, lastFrame);
              else callbacks.onExcludeRange?.(firstFrame, lastFrame);
            }
          }
        }
      }

      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const finalPatch: Record<string, unknown> = pendingPatch ?? {};
      pendingPatch = null;
      if (sliderHidden) {
        finalPatch['xaxis.rangeslider.visible'] = true;
        sliderHidden = false;
      }
      if (Object.keys(finalPatch).length > 0) {
        void Plotly.relayout(plotId, finalPatch);
      }

      kind = null;
    };

    div.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, true);
    return () => {
      div.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp, true);
      overlay.remove();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [plotId, enableModifierSelect, hideSlider, callbacks]);
}
```

- [ ] **Step 3: Replace the inline drag-handler useEffect inside `GuideGraph.tsx`**

Open `web/src/components/GuideGraph.tsx`. Find the comment `// All custom drag gestures (Y zoom + X pan, include/exclude).` and the giant `useEffect` that follows. **Delete that entire useEffect** through its closing `}, [plotId, scaleLocked]);`.

In its place, add (verify imports — `useChartGestures` is new):

```tsx
  useChartGestures(
    plotId,
    {
      onIncludeRange: (lo, hi) => {
        const ctx = dataRef.current;
        if (!ctx) return;
        includeRangeRef.current(
          ctx.sessionIdx,
          ctx.session.entries.length,
          lo,
          hi,
          ctx.session.entries.map((e) => e.frame),
        );
      },
      onExcludeRange: (lo, hi) => {
        const ctx = dataRef.current;
        if (!ctx) return;
        excludeRangeRef.current(
          ctx.sessionIdx,
          ctx.session.entries.length,
          lo,
          hi,
          ctx.session.entries.map((e) => e.frame),
        );
      },
      onRangeChange: (axis, range) => {
        const idx = dataRef.current?.sessionIdx;
        if (idx === undefined) return;
        const cur = sectionViews.get(idx) ?? {};
        if (axis === 'x') sectionViews.set(idx, { ...cur, x: range });
        else {
          sectionViews.set(idx, { ...cur, y: range });
          if (scaleLocked) lockedYView = range;
        }
      },
      rangeContext: () => {
        const ctx = dataRef.current;
        if (!ctx) return null;
        const entries = ctx.session.entries;
        return {
          frames: entries.map((e) => e.frame),
          dts: entries.map((e) => e.dt),
        };
      },
    },
    { enableModifierSelect: true, hideRangeSliderDuringDrag: true },
  );
```

Add the import at the top: `import { useChartGestures } from './useChartGestures';`

- [ ] **Step 4: Run unit tests + typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS — parser tests don't touch this file; typecheck verifies the refactor is well-typed.

- [ ] **Step 5: Run the per-section memory e2e test (the one most sensitive to this refactor)**

Run: `cd web && npm run e2e -- --grep "per-section view"`
Expected: PASS (1 passing, 0 failing).

- [ ] **Step 6: Run the full e2e suite for safety**

Run: `cd web && npm run e2e`
Expected: 19+ passed, 1 skipped (matches the prior-session count).

- [ ] **Step 7: Commit**

```bash
cd web
git add src/components/useChartGestures.ts src/components/GuideGraph.tsx
git commit -m "Extract useChartGestures hook from GuideGraph for analysis modal reuse"
```

---

### Task 9: `DriftChart` component

**Files:**
- Create: `web/src/components/DriftChart.tsx`

The drift-corrected timeline chart for the Analysis modal. Two `scattergl` traces (RA + Dec, with Dec negated for display), zero-centered Y axis, hover strip below.

- [ ] **Step 1: Implement `web/src/components/DriftChart.tsx`**

```tsx
import { useId, useMemo, useState, useCallback } from 'react';
import Plot from 'react-plotly.js';
import type { Data, Layout } from 'plotly.js';
import type { GARun } from '../parser/analyze';
import { useChartGestures } from './useChartGestures';

const RA_COLOR = '#60a5fa';
const DEC_COLOR = '#f87171';

interface PlotlyHoverEvent {
  points?: Array<{ x?: number; y?: number; curveNumber?: number }>;
}

interface DriftChartProps {
  garun: GARun;
  showRa: boolean;
  showDec: boolean;
  scaleMode: 'PIXELS' | 'ARCSEC';
}

const formatClock = (startsMs: number | null, dt: number): string => {
  if (startsMs === null) return '—';
  const t = new Date(startsMs + dt * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
};

/**
 * Drift-corrected RA/Dec timeline. Mirrors PaintDrift in
 * AnalysisWin.cpp:936-1063: zero-centered Y axis, RA in sky-blue, Dec in
 * rose with the same display-time negation (positive Dec points up).
 */
export function DriftChart({ garun, showRa, showDec, scaleMode }: DriftChartProps) {
  const plotId = useId().replace(/:/g, '_');
  const [hover, setHover] = useState<string | null>(null);

  const k = scaleMode === 'ARCSEC' ? garun.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';

  const traces = useMemo<Data[]>(() => {
    const out: Data[] = [];
    const x = Array.from(garun.t);
    if (showRa) {
      out.push({
        x, y: Array.from(garun.rac).map((v) => v * k),
        type: 'scattergl', mode: 'lines',
        name: 'RA', line: { color: RA_COLOR, width: 1.5 },
      } as Data);
    }
    if (showDec) {
      out.push({
        x,
        // Display-time negation matches AnalysisWin.cpp:1059 (`ymid - decc[i]`).
        y: Array.from(garun.decc).map((v) => -v * k),
        type: 'scattergl', mode: 'lines',
        name: 'Dec', line: { color: DEC_COLOR, width: 1.5 },
      } as Data);
    }
    return out;
  }, [garun, showRa, showDec, k]);

  const yRange = useMemo<[number, number]>(() => {
    let max = 1e-9;
    for (const v of garun.rac) max = Math.max(max, Math.abs(v * k));
    for (const v of garun.decc) max = Math.max(max, Math.abs(v * k));
    return [-max * 1.1, max * 1.1];
  }, [garun, k]);

  useChartGestures(plotId, {}, { enableModifierSelect: false });

  const onHover = useCallback((ev: PlotlyHoverEvent) => {
    const x = ev.points?.[0]?.x;
    const y = ev.points?.[0]?.y;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const yPx = scaleMode === 'ARCSEC' ? y / garun.pixelScale : y;
    const yArc = scaleMode === 'ARCSEC' ? y : y * garun.pixelScale;
    setHover(`Time: ${x.toFixed(1)}s  ${formatClock(garun.starts, x)}    Y: ${yArc.toFixed(2)}″ (${yPx.toFixed(2)}px)`);
  }, [garun, scaleMode]);

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 10, b: 30 },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: { color: '#cbd5e1', size: 11 },
    xaxis: { title: { text: 'time (s)' }, gridcolor: '#1e293b', zerolinecolor: '#334155', fixedrange: false, autorange: true },
    yaxis: { title: { text: unit }, gridcolor: '#1e293b', zerolinecolor: '#64748b', zerolinewidth: 1, fixedrange: true, range: yRange },
    showlegend: true,
    legend: { orientation: 'h', y: 1.1 },
    dragmode: false,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <Plot
          divId={plotId}
          data={traces}
          layout={layout}
          config={{ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onHover={onHover as never}
          onUnhover={() => setHover(null)}
        />
      </div>
      <div className="border-t border-slate-800 bg-slate-900/40 px-3 py-1 font-mono text-[11px] text-slate-300 min-h-[24px]">
        {hover ?? ' '}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd web
git add src/components/DriftChart.tsx
git commit -m "Add DriftChart for analysis modal"
```

---

### Task 10: `PeriodogramChart` with peak-snap cursor

**Files:**
- Create: `web/src/components/PeriodogramChart.tsx`

Period-on-X amplitude line, with the desktop's local-max snap behavior on hover.

- [ ] **Step 1: Implement `web/src/components/PeriodogramChart.tsx`**

```tsx
import { useId, useMemo, useState, useCallback, useEffect } from 'react';
import Plot from 'react-plotly.js';
import type { Data, Layout } from 'plotly.js';
import type { GARun } from '../parser/analyze';
import { useChartGestures } from './useChartGestures';

const PEAK_PX = 8;
const FFT_COLOR = '#a3e635';

interface PlotDiv extends HTMLDivElement {
  _fullLayout?: {
    xaxis?: { _offset: number; _length: number; range: [number, number]; type?: string };
  };
}

interface PeriodogramChartProps {
  garun: GARun;
  scaleMode: 'PIXELS' | 'ARCSEC';
}

/**
 * Periodogram (period vs. amplitude). Mirrors PaintFFT in
 * AnalysisWin.cpp:1076-1182 plus the OnMove peak-snap logic at lines
 * 853-918. The hover readout is the periodic-error report — period,
 * amplitude (″/px), peak-to-peak, RMS — that the desktop puts in its
 * status bar.
 */
export function PeriodogramChart({ garun, scaleMode }: PeriodogramChartProps) {
  const plotId = useId().replace(/:/g, '_');
  const [hover, setHover] = useState<string | null>(null);

  const k = scaleMode === 'ARCSEC' ? garun.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';

  const traces = useMemo<Data[]>(() => [
    {
      x: Array.from(garun.fftPeriod),
      y: Array.from(garun.fftAmplitude).map((v) => v * k),
      type: 'scatter', mode: 'lines',
      name: 'amplitude',
      line: { color: FFT_COLOR, width: 1.5 },
      fill: 'tozeroy',
      fillcolor: 'rgba(163, 230, 53, 0.1)',
    } as Data,
  ], [garun, k]);

  useChartGestures(plotId, {}, { enableModifierSelect: false });

  /**
   * Find the closest local-max peak in the periodogram within ±PEAK_PX of the
   * cursor's screen position. Mirrors AnalysisWin.cpp:864-907.
   */
  const snapToPeak = useCallback((cursorPeriod: number): { period: number; amplitude: number } => {
    const div = document.getElementById(plotId) as PlotDiv | null;
    const xa = div?._fullLayout?.xaxis;
    if (!xa || !xa._length) {
      return { period: cursorPeriod, amplitude: garun.fftSpline.at(cursorPeriod) };
    }
    const periods = garun.fftPeriod;
    const amps = garun.fftAmplitude;
    const isLog = xa.type === 'log';
    const toPx = (p: number): number => {
      if (isLog) {
        const r0 = Math.pow(10, xa.range[0]);
        const r1 = Math.pow(10, xa.range[1]);
        return ((Math.log10(p) - Math.log10(r0)) / (Math.log10(r1) - Math.log10(r0))) * xa._length;
      }
      return ((p - xa.range[0]) / (xa.range[1] - xa.range[0])) * xa._length;
    };
    const cursorPx = toPx(cursorPeriod);
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 1; i < periods.length - 1; i++) {
      const px = toPx(periods[i]);
      if (Math.abs(px - cursorPx) > PEAK_PX) continue;
      if (amps[i] > amps[i - 1] && amps[i] > amps[i + 1]) {
        const d = Math.abs(px - cursorPx);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
    }
    if (bestIdx >= 0) return { period: periods[bestIdx], amplitude: amps[bestIdx] };
    return { period: cursorPeriod, amplitude: garun.fftSpline.at(cursorPeriod) };
  }, [plotId, garun]);

  const onHover = useCallback((ev: { points?: Array<{ x?: number }> }) => {
    const x = ev.points?.[0]?.x;
    if (typeof x !== 'number') return;
    const { period, amplitude } = snapToPeak(x);
    const aPx = amplitude;
    const aArc = amplitude * garun.pixelScale;
    const ppArc = 2 * aArc;
    const ppPx = 2 * aPx;
    const rmsArc = aArc / Math.SQRT2;
    const rmsPx = aPx / Math.SQRT2;
    setHover(
      `Period: ${period.toFixed(1)}s  Amplitude: ${aArc.toFixed(2)}″ (${aPx.toFixed(2)}px)  ` +
      `P-P: ${ppArc.toFixed(2)}″ (${ppPx.toFixed(2)}px)  ` +
      `RMS: ${rmsArc.toFixed(2)}″ (${rmsPx.toFixed(2)}px)`,
    );
  }, [garun, snapToPeak]);

  // Quiet the unused-variable warning for `unit/k` when scaleMode is PIXELS.
  useEffect(() => { void unit; void k; }, [unit, k]);

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 10, b: 40 },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: { color: '#cbd5e1', size: 11 },
    xaxis: {
      title: { text: 'period (s)' }, gridcolor: '#1e293b', zerolinecolor: '#334155',
      type: 'log', autorange: true, fixedrange: false,
    },
    yaxis: {
      title: { text: `amplitude (${unit === '″' ? 'arc-sec' : 'px'})` },
      gridcolor: '#1e293b', zerolinecolor: '#334155',
      autorange: true, fixedrange: true,
    },
    showlegend: false,
    dragmode: false,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <Plot
          divId={plotId}
          data={traces}
          layout={layout}
          config={{ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onHover={onHover as never}
          onUnhover={() => setHover(null)}
        />
      </div>
      <div className="border-t border-slate-800 bg-slate-900/40 px-3 py-1 font-mono text-[11px] text-slate-300 min-h-[24px] whitespace-pre-wrap">
        {hover ?? ' '}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd web
git add src/components/PeriodogramChart.tsx
git commit -m "Add PeriodogramChart with peak-snap cursor"
```

---

### Task 11: `AnalysisModal` and ViewerPage wiring

**Files:**
- Create: `web/src/components/AnalysisModal.tsx`
- Modify: `web/src/pages/ViewerPage.tsx` (mount modal at root, pass through Esc)

- [ ] **Step 1: Implement `web/src/components/AnalysisModal.tsx`**

```tsx
import { useEffect } from 'react';
import { useAnalysisStore } from '../state/analysisStore';
import { DriftChart } from './DriftChart';
import { PeriodogramChart } from './PeriodogramChart';

const formatClockUTC = (ms: number | null, dt: number): string => {
  if (ms === null) return '—';
  const t = new Date(ms + dt * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
};

/**
 * Full-screen analysis overlay. Mounts at the page root so it overlays
 * everything; renders nothing when the analysisStore says state==='closed'.
 */
export function AnalysisModal() {
  const s = useAnalysisStore();
  useEffect(() => {
    if (s.state !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') s.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  if (s.state === 'closed') return null;

  const { garun, kind, showRa, showDec, scaleMode } = s;
  const startClock = formatClockUTC(garun.starts, garun.t[0] ?? 0);
  const endClock = formatClockUTC(garun.starts, garun.t[garun.t.length - 1] ?? 0);
  let title: string;
  if (kind === 'unguided') {
    title = `Analysis · unguided section · frames ${garun.range.begin}-${garun.range.end}`;
  } else if (kind === 'all-raw-ra') {
    title = `Analysis · RA corrections removed · ${garun.t.length} frames · ${startClock} — ${endClock}`;
  } else {
    title = `Analysis · ${garun.t.length} frames · ${startClock} — ${endClock}`;
  }

  const ToggleChip = ({
    label, active, onClick, title: tip,
  }: { label: string; active: boolean; onClick: () => void; title?: string }) => (
    <button
      onClick={onClick}
      title={tip}
      className={`rounded px-2 py-0.5 text-xs transition-colors ${
        active ? 'bg-sky-700 text-white hover:bg-sky-600' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h2 className="text-sm font-medium" title="Source range and analysis mode for this run">{title}</h2>
        <button
          className="rounded px-2 py-0.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          onClick={s.close}
          title="Close the analysis view (Esc)"
        >
          ✕
        </button>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
        <span className="mr-1 text-slate-500" title="Toggle individual drift traces">show:</span>
        <ToggleChip label="RA" active={showRa} onClick={() => s.setShowRa(!showRa)} title="Show/hide drift-corrected RA trace" />
        <ToggleChip label="Dec" active={showDec} onClick={() => s.setShowDec(!showDec)} title="Show/hide drift-corrected Dec trace" />
        <span className="ml-3 mr-1 text-slate-500" title="Y-axis units">scale:</span>
        <ToggleChip label="arc-sec" active={scaleMode === 'ARCSEC'} onClick={() => s.setScaleMode('ARCSEC')} title="Display Y in arc-seconds" />
        <ToggleChip label="pixels" active={scaleMode === 'PIXELS'} onClick={() => s.setScaleMode('PIXELS')} title="Display Y in pixels" />
        <span
          className="ml-auto text-slate-600"
          title="Mouse wheel zooms X around the cursor. Plain drag pans X and zooms Y. Hover the periodogram to snap the cursor to the nearest peak."
        >
          scroll = X zoom · drag = X pan + Y zoom · hover periodogram = peak snap
        </span>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 border-b border-slate-800">
          <DriftChart garun={garun} showRa={showRa} showDec={showDec} scaleMode={scaleMode} />
        </div>
        <div className="flex-1">
          <PeriodogramChart garun={garun} scaleMode={scaleMode} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount `<AnalysisModal>` at the page root**

In `web/src/pages/ViewerPage.tsx`, add the import:

```tsx
import { AnalysisModal } from '../components/AnalysisModal';
```

Find the outer return JSX. Wrap each branch's returned element in a fragment and render `<AnalysisModal />` after it. Concretely change:

```tsx
  return (
    <div className="grid h-full grid-cols-[260px_1fr] grid-rows-[auto_1fr]">
      ...existing layout...
    </div>
  );
}
```

to:

```tsx
  return (
    <>
      <div className="grid h-full grid-cols-[260px_1fr] grid-rows-[auto_1fr]">
        ...existing layout...
      </div>
      <AnalysisModal />
    </>
  );
}
```

(Apply the same wrap to the empty-state branch — render `<AnalysisModal />` after the drop-zone block too.)

- [ ] **Step 3: Typecheck and run unit tests**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/components/AnalysisModal.tsx src/pages/ViewerPage.tsx
git commit -m "Add AnalysisModal and mount it at the ViewerPage root"
```

---

### Task 12: Wire context-menu items

**Files:**
- Modify: `web/src/components/ContextMenu.tsx`

The three "Analyze..." items currently have `disabled` and a "v3" hint. Now they call `analyze(...)` and open the modal.

- [ ] **Step 1: Add the supporting imports and helpers near the top of the component body**

Open `web/src/components/ContextMenu.tsx`. Add to the imports (verify `useViewStore` is already imported — it is for `exclusions`):

```tsx
import { canAnalyze, analyze, findUnguidedWindow } from '../parser/analyze';
import type { AnalysisKind } from '../state/analysisStore';
import { useAnalysisStore } from '../state/analysisStore';
```

Inside the `GraphContextMenu` function body, after the existing variable declarations (`session`, `sessionIdx`, `exclusions`, etc.), add:

```tsx
  const openAnalysis = useAnalysisStore((s) => s.open);
  const scaleModeForAnalysis = useViewStore((s) => s.scaleMode);
  const sessionMask = sessionIdx >= 0 ? exclusions.get(sessionIdx) : undefined;

  const canAnalyzeSession = session
    ? canAnalyze(session, {
        range: { begin: 0, end: session.entries.length },
        undoRaCorrections: false,
        mask: sessionMask,
      })
    : false;

  const unguidedRange = session ? findUnguidedWindow(session) : null;

  const runAnalysis = (kind: AnalysisKind, undoRaCorrections: boolean, range?: { begin: number; end: number }) => {
    if (!session) return;
    const r = range ?? { begin: 0, end: session.entries.length };
    try {
      const garun = analyze(session, { range: r, undoRaCorrections, mask: sessionMask });
      openAnalysis({ garun, kind, initialScaleMode: scaleModeForAnalysis });
    } catch (err) {
      // canAnalyze gates the call site, but stay defensive — if analyze
      // throws (insufficient entries after edge-case filtering), surface
      // it via console for now.
      // eslint-disable-next-line no-console
      console.error('analyze failed:', err);
    }
  };
```

- [ ] **Step 2: Replace the three Analyze menu items**

Find the block with the three items currently rendered as:

```tsx
<Item disabled hint="v3" title="Coming in v3 — drift-corrected timeline + periodogram">Analyze selected frames</Item>
<Item disabled hint="v3" title="Coming in v3 — analysis with RA corrections undone">Analyze selected, raw RA</Item>
{isUnguided && <Item disabled hint="v3" title="Coming in v3 — analyze a Guiding Assistant unguided section">Analyze unguided section</Item>}
```

Replace with:

```tsx
<Item
  disabled={!session || !canAnalyzeSession}
  onSelect={() => session && runAnalysis('all', false)}
  title="Analyze every included, non-excluded frame: drift-corrected timeline + FFT periodogram"
>
  Analyze selected frames
</Item>
<Item
  disabled={!session || !canAnalyzeSession}
  onSelect={() => session && runAnalysis('all-raw-ra', true)}
  title="Same range, but with RA corrections re-added — shows what tracking would have looked like unguided"
>
  Analyze selected, raw RA
</Item>
{isUnguided && (
  <Item
    disabled={!unguidedRange}
    onSelect={() => session && unguidedRange && runAnalysis('unguided', false, unguidedRange)}
    title="Analyze the first contiguous unguided window in the session (Guiding Assistant case)"
  >
    Analyze unguided section
  </Item>
)}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Quick smoke check via the dev server**

```bash
cd web && npm run dev
```

Open the dev URL, drop the synthetic log, click the guiding section, right-click → Analyze selected frames. The modal opens with both charts. Right-click → Analyze selected, raw RA — title shows "RA corrections removed". Right-click → Analyze unguided section — title shows "unguided section · frames 5-7" (or similar, based on the synthetic fixture from Task 6).

Stop the dev server when satisfied (`taskkill //F //IM node.exe` on Windows, Ctrl+C on POSIX).

- [ ] **Step 5: Commit**

```bash
cd web
git add src/components/ContextMenu.tsx
git commit -m "Wire Analyze... menu items to analysisStore"
```

---

### Task 13: Playwright e2e coverage

**Files:**
- Create: `web/e2e/analysis.spec.ts`

- [ ] **Step 1: Write the e2e tests**

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'synthetic.log');

const dropFixture = async (page: import('@playwright/test').Page) => {
  const text = readFileSync(SYNTHETIC, 'utf-8');
  await page.setInputFiles('input[type=file]', {
    name: 'synthetic.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });
};

test.describe('Analysis modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('Analyze selected frames opens the modal with both charts', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze selected frames' }).click();

    await expect(page.getByRole('heading', { name: /Analysis · \d+ frames/ })).toBeVisible();
    await expect(page.locator('.fixed.inset-0 .js-plotly-plot')).toHaveCount(2);
    await page.getByRole('button', { name: '✕' }).click();
    await expect(page.locator('.fixed.inset-0')).not.toBeVisible();
  });

  test('Analyze selected, raw RA shows "RA corrections removed" in the title', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze selected, raw RA' }).click();
    await expect(page.getByRole('heading', { name: /RA corrections removed/ })).toBeVisible();
  });

  test('Analyze unguided section shows "unguided section" in the title', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze unguided section' }).click();
    await expect(page.getByRole('heading', { name: /unguided section/ })).toBeVisible();
  });

  test('hovering the periodogram populates a Period: readout', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze selected frames' }).click();
    const charts = page.locator('.fixed.inset-0 .js-plotly-plot');
    const periodogram = charts.last();
    const box = await periodogram.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
    await expect(page.locator('.fixed.inset-0 .font-mono').last()).toContainText(/Period:/);
  });

  test('Esc closes the modal', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze selected frames' }).click();
    await expect(page.locator('.fixed.inset-0')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.fixed.inset-0')).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `cd web && npm run e2e`
Expected: 24+ passing (the prior 19 + the 5 new analysis tests + the existing 1 skipped real-sample case).

If a test fails, inspect Playwright's `test-results/` artifacts and fix in place. Common gotchas:
- The hover test may need a longer wait on slower machines — bump to 400 ms.
- The "✕" close button uses a literal multiplication-sign glyph; if it fails to match, fall back to `getByTitle('Close the analysis view (Esc)')`.
- The unguided test depends on the Task 6 fixture extension. If it's not present, the menu item will be hidden and the test will time out trying to click it.

- [ ] **Step 3: Commit**

```bash
cd web
git add e2e/analysis.spec.ts
git commit -m "Add e2e coverage for the analysis modal"
```

---

### Task 14: Final integration sanity + push

- [ ] **Step 1: Run the full local quality gate**

```bash
cd web && npm run typecheck && npm test && npm run e2e && npm run build
```

Expected: typecheck passes, all unit tests pass, all e2e tests pass (24+ green, 1 skipped), build succeeds with the existing chunk-size warning (no new errors).

- [ ] **Step 2: Push the branch to GitHub**

```bash
cd web
git push
```

The pre-commit hook bumps the patch version per commit; the final version on `main` will be near `v0.3.x`. If you want a clean v3 marker, do a one-line minor bump:

```bash
cd web
npm version minor --no-git-tag-version
git add package.json package-lock.json
git commit -m "Bump to v0.3.0 — analysis modal"
git push
```

- [ ] **Step 3: Mirror commits to the parent repo**

```bash
cd ..
git add web/
git -c user.email=bvalente@gmail.com -c user.name=bvalente commit -m "v3: analysis modal landed"
```

(No push — the parent repo is local-only.)

- [ ] **Step 4: Restart the dev server with the final build**

```bash
cd web && npm run dev
```

Confirm the dev URL is reachable and the modal works against a real PHD2 sample.

---

## Spec coverage check

- §3 entry points → Task 12
- §4 architecture → Tasks 1–11 (file layout matches the plan one-to-one)
- §5 math → Tasks 1–5 (spline → fft → drift → full pipeline)
- §6 modal layout & hover readouts → Tasks 9, 10, 11
- §7 shared `useChartGestures` → Task 8
- §8 `analysisStore` → Task 7
- §9 testing → unit tests in Tasks 1–6, e2e in Task 13
- §10 done definition → Task 14 final gate
