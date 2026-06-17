# Polar Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-section polar-alignment readout (total error + Altitude/Azimuth split + RA/Dec drift) with a stoplight target-plot graphic to the guiding stats footer, computed with the validated back-out-corrections algorithm.

**Architecture:** A pure parser module (`polarAlignment.ts`) computes drift (algebraic RA endpoint; cumulative Dec slope with the skip-gaps rule), total PAE, and the hour-angle Alt/Az projection. `calcStats` consumes it and exposes the fields on `SessionStats` (replacing the existing broken drift/PAE). `StatsGrid` renders a new "Polar Alignment" subtitled area and a presentational `PolarAlignmentPlot` SVG component beside the numbers.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (pure-logic unit tests; no React Testing Library), i18next (en/es/de/fr/it/zh), Tailwind.

## Global Constraints

- Work on a feature branch `feat/polar-alignment` — `main` only advances via PR per `CLAUDE.md`. Push after commits; open the PR in the final task.
- After every task: `cd web && npx tsc --noEmit && npx vitest run` must be clean.
- PAE constant is exactly `3.8197`. Dec drift uses the **skip-gaps** rule (do not accumulate a Dec delta across an excluded/settling gap). Settling exclusion is **API-only** (between `Settling start…` and `Settling complete`/`Settling fail`).
- Trust threshold: an axis is low-confidence when its sensitivity (`|cos HA|` for Az, `|sin HA|` for Alt) `< 0.30`.
- PHD2 jargon stays English across all locales: `RA`, `Dec`, `Alt`, `Az`, `PAE`. Descriptive labels/tooltips are translated.
- All paths are relative to the repo root; the web app lives under `web/`. Run npm/test commands from `web/`.

---

### Task 1: Parse hour angle + pier side onto GuideSession

**Files:**
- Modify: `web/src/parser/types.ts` (add fields + defaults)
- Modify: `web/src/parser/parseLog.ts:125-128` (parse from the `RA = …` header line)
- Test: `web/src/parser/__tests__/parseLog.test.ts` (create)

**Interfaces:**
- Produces: `GuideSession.hourAngleHours: number | null`, `GuideSession.pierSide: string | null`.

- [ ] **Step 1: Write the failing test**

Create `web/src/parser/__tests__/parseLog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseLog } from '../parseLog';

const HEADER = [
  'Frame,Time,mount,dx,dy,RARawDistance,DECRawDistance,RAGuideDistance,DECGuideDistance,RADuration,RADirection,DECDuration,DECDirection,XStep,YStep,StarMass,SNR,ErrorCode',
  '1,1.000,"Mount",0,0,0,0,0,0,0,,0,,,,1000,50,0',
  'Guiding Ends at 2026-06-09 22:26:10',
].join('\n');

const withHa = [
  'Guiding Begins at 2026-06-09 22:26:06',
  'Pixel scale = 5.04 arc-sec/px, Binning = 1, Focal length = 240 mm',
  'RA = 21.64 hr, Dec = 56.5 deg, Hour angle = -7.54 hr, Pier side = West, Rotator pos = N/A, Alt = 19.8 deg, Az = 32.7 deg',
  HEADER,
].join('\n');

const noHa = [
  'Guiding Begins at 2026-06-09 22:26:06',
  'Pixel scale = 5.04 arc-sec/px, Binning = 1, Focal length = 240 mm',
  'RA = 21.64 hr, Dec = 56.5 deg',
  HEADER,
].join('\n');

describe('parseLog hour angle / pier side', () => {
  it('parses hour angle and pier side from the header', () => {
    const log = parseLog(withHa);
    const s = log.sessions[0];
    expect(s.hourAngleHours).toBeCloseTo(-7.54, 2);
    expect(s.pierSide).toBe('West');
    expect(s.declination).toBeCloseTo((56.5 * Math.PI) / 180, 5);
  });

  it('leaves hour angle / pier side null when absent', () => {
    const log = parseLog(noHa);
    const s = log.sessions[0];
    expect(s.hourAngleHours).toBeNull();
    expect(s.pierSide).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/parser/__tests__/parseLog.test.ts`
Expected: FAIL (`hourAngleHours`/`pierSide` undefined, not null).

- [ ] **Step 3: Add the fields to the type + factory**

In `web/src/parser/types.ts`, add two fields to `GuideSession` (after `declination: number;`):

```ts
  declination: number;
  hourAngleHours: number | null;
  pierSide: string | null;
```

And in `newGuideSession`, after `declination: 0,`:

```ts
  declination: 0,
  hourAngleHours: null,
  pierSide: null,
```

- [ ] **Step 4: Parse them in parseLog**

In `web/src/parser/parseLog.ts`, replace the existing `RA = ` branch (currently lines ~125-128):

```ts
      } else if (startsWith(ln, 'RA = ')) {
        const decDeg = getDbl(ln, ' hr, Dec = ', 0);
        s.declination = (decDeg * Math.PI) / 180;
      }
```

with:

```ts
      } else if (startsWith(ln, 'RA = ')) {
        const decDeg = getDbl(ln, ' hr, Dec = ', 0);
        s.declination = (decDeg * Math.PI) / 180;
        // Hour angle (hours) — presence-checked because 0h is a valid value
        // (the meridian), so a missing field must stay null, not default to 0.
        if (ln.indexOf('Hour angle = ') >= 0) {
          s.hourAngleHours = getDbl(ln, 'Hour angle = ', 0);
        }
        const pi = ln.indexOf('Pier side = ');
        if (pi >= 0) {
          s.pierSide = ln.slice(pi + 'Pier side = '.length).split(',')[0].trim();
        }
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/parser/__tests__/parseLog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/parser/types.ts web/src/parser/parseLog.ts web/src/parser/__tests__/parseLog.test.ts
git commit -m "feat(parser): parse hour angle and pier side onto GuideSession"
```

---

### Task 2: Drift core in polarAlignment.ts (settling mask + RA/Dec drift)

**Files:**
- Create: `web/src/parser/polarAlignment.ts`
- Test: `web/src/parser/__tests__/polarAlignment.test.ts` (create)

**Interfaces:**
- Consumes: `GuideSession` (Task 1 fields), `starWasFound` from `./tokens`.
- Produces: `settlingMask(session): boolean[]`; `computePolarAlignment(session, mask?): PolarAlignment` returning at least `{ driftRaPxMin, driftDecPxMin }` (extended in Task 3).

- [ ] **Step 1: Write the failing tests**

Create `web/src/parser/__tests__/polarAlignment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computePolarAlignment, settlingMask } from '../polarAlignment';
import { newGuideSession } from '../types';
import type { GuideEntry, GuideSession } from '../types';

// Full entry builder (mkE in stats.test only sets ra/dec).
const e = (o: Partial<GuideEntry>): GuideEntry => ({
  frame: 0, dt: 0, mount: 'MOUNT', included: true, guiding: true,
  dx: 0, dy: 0, raraw: 0, decraw: 0, raguide: 0, decguide: 0,
  radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '', ...o,
});

const session = (entries: GuideEntry[], extra: Partial<GuideSession> = {}): GuideSession => {
  const s = newGuideSession('x');
  s.entries = entries; s.pixelScale = 1; s.declination = 0; s.hourAngleHours = 0;
  Object.assign(s, extra);
  return s;
};

describe('settlingMask', () => {
  it('excludes entries between Settling started and Settling complete', () => {
    const s = session([e({ dt: 0 }), e({ dt: 1 }), e({ dt: 2 }), e({ dt: 3 })]);
    s.infos = [
      { idx: 1, repeats: 1, info: 'SETTLING STATE CHANGE, Settling started' },
      { idx: 3, repeats: 1, info: 'SETTLING STATE CHANGE, Settling complete' },
    ];
    expect(settlingMask(s)).toEqual([false, true, true, false]);
  });
});

describe('computePolarAlignment drift', () => {
  it('RA drift backs out corrections via the endpoint formula', () => {
    // raraw ramps 0..3 over 180s, but 1.0 px of correction was applied total.
    // Uncorrected displacement = (3 - 0) - (-1) ... here raguide sums to 1 on a
    // pulsed frame, so endpoint = (3 - 0 - 1)/180 px/s = 2/180; *60 = 0.6667 px/min.
    const s = session([
      e({ dt: 0, raraw: 0 }),
      e({ dt: 60, raraw: 1, raguide: 1, radur: 50 }),
      e({ dt: 120, raraw: 2 }),
      e({ dt: 180, raraw: 3 }),
    ]);
    const pa = computePolarAlignment(s);
    expect(pa.driftRaPxMin).toBeCloseTo((3 - 0 - 1) / 180 * 60, 4);
  });

  it('Dec drift is the cumulative-uncorrected slope', () => {
    // All frames un-pulsed & adjacent: cumulative = raw decraw ramp 0..3 over 180s.
    const s = session([
      e({ dt: 0, decraw: 0 }),
      e({ dt: 60, decraw: 1 }),
      e({ dt: 120, decraw: 2 }),
      e({ dt: 180, decraw: 3 }),
    ]);
    const pa = computePolarAlignment(s);
    expect(pa.driftDecPxMin).toBeCloseTo(1, 4); // 1 px/min
  });

  it('Dec drift does NOT accumulate across a settling gap (skip-gaps)', () => {
    // decraw jumps from 0.1 to 5.0 across a settling gap (lock moved). Without
    // skip-gaps the slope would be huge; with it, the gap delta is ignored so
    // the trend stays ~0.
    const s = session([
      e({ dt: 0, decraw: 0.0 }),
      e({ dt: 60, decraw: 0.1 }),  // last before gap
      e({ dt: 120, decraw: 5.0 }), // first after gap (excluded-neighbor → skip delta)
      e({ dt: 180, decraw: 5.1 }),
    ]);
    s.infos = [
      { idx: 2, repeats: 1, info: 'Settling started' },
      { idx: 2, repeats: 1, info: 'Settling complete' }, // excludes nothing here…
    ];
    // Force a gap by excluding index 2 via the mask (simulates a dropped/settling frame).
    const mask = new Uint8Array([0, 0, 1, 0]);
    const pa = computePolarAlignment(s, mask);
    // Included indices: 0,1,3. Pair (1->3) is non-adjacent (idx 2 excluded) → its
    // delta is skipped. Pair (0->1) delta = +0.1. So cumulative is tiny, slope small.
    expect(Math.abs(pa.driftDecPxMin)).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/parser/__tests__/polarAlignment.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module (drift core)**

Create `web/src/parser/polarAlignment.ts`:

```ts
import type { GuideSession } from './types';
import { starWasFound } from './tokens';

export const PAE_CONSTANT = 3.8197;
// Below this sensitivity (|cos HA| for Az, |sin HA| for Alt) the axis is
// essentially unobservable from this section's Dec drift — flagged low-confidence.
export const TRUST_THRESHOLD = 0.30;

export interface PolarAlignment {
  driftRaPxMin: number;
  driftDecPxMin: number;
  paeTotalArcMin: number;
  altArcMin: number | null;
  azArcMin: number | null;
  altTrust: boolean;
  azTrust: boolean;
  hourAngleHours: number | null;
}

// Per-entry settling-exclusion flags from the parsed INFO events. Mirrors
// phdlogview ExcludeSettlingByAPI: exclude entries in [start, complete).
export function settlingMask(session: GuideSession): boolean[] {
  const out = new Array<boolean>(session.entries.length).fill(false);
  let settling = false;
  let startIdx = 0;
  for (const info of session.infos) {
    if (settling) {
      if (info.info.includes('Settling complete') || info.info.includes('Settling fail')) {
        settling = false;
        for (let i = startIdx; i < info.idx && i < out.length; i++) out[i] = true;
      }
    } else if (info.info.includes('Settling start')) {
      settling = true;
      startIdx = info.idx;
    }
  }
  if (settling) for (let i = startIdx; i < out.length; i++) out[i] = true;
  return out;
}

const slope = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx; num += dx * (ys[i] - my); den += dx * dx; }
  return den === 0 ? 0 : num / den;
};

export function computePolarAlignment(session: GuideSession, mask?: Uint8Array): PolarAlignment {
  const entries = session.entries;
  const settle = settlingMask(session);
  const included = (i: number): boolean =>
    entries[i].included && starWasFound(entries[i].err) &&
    !(mask && mask[i] === 1) && !settle[i];

  let firstIdx = -1, lastIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    if (included(i)) { if (firstIdx < 0) firstIdx = i; lastIdx = i; }
  }

  let driftRaPps = 0, driftDecPps = 0;
  if (firstIdx >= 0 && lastIdx > firstIdx) {
    // RA: (raraw_last − raraw_first − Σ RA corrections) / elapsed.
    let sum = 0;
    for (let i = firstIdx; i < entries.length; i++) {
      if (included(i) && entries[i].radur !== 0) sum += entries[i].raguide;
    }
    const dtSpan = entries[lastIdx].dt - entries[firstIdx].dt;
    if (dtSpan > 0) {
      driftRaPps = (entries[lastIdx].raraw - entries[firstIdx].raraw - sum) / dtSpan;
    }

    // Dec: slope of cumulative uncorrected Dec. Accumulate a delta only across
    // an *adjacent* pair (no excluded frame between them) where the previous
    // frame was un-pulsed (decdur === 0). Adjacency = skip-gaps rule.
    let yAccum = 0;
    let prevIdx = firstIdx;
    let prevDec = entries[firstIdx].decraw;
    let prevGuided = entries[firstIdx].decdur !== 0;
    const xs = [entries[firstIdx].dt];
    const ys = [0];
    for (let i = firstIdx + 1; i <= lastIdx; i++) {
      if (!included(i)) continue;
      if (!prevGuided && i === prevIdx + 1) {
        yAccum += entries[i].decraw - prevDec;
        xs.push(entries[i].dt);
        ys.push(yAccum);
      }
      prevDec = entries[i].decraw;
      prevGuided = entries[i].decdur !== 0;
      prevIdx = i;
    }
    driftDecPps = slope(xs, ys);
  }

  const driftRaPxMin = driftRaPps * 60;
  const driftDecPxMin = driftDecPps * 60;

  // PAE + decomposition are filled in Task 3; provide safe defaults for now.
  return {
    driftRaPxMin,
    driftDecPxMin,
    paeTotalArcMin: 0,
    altArcMin: null,
    azArcMin: null,
    altTrust: false,
    azTrust: false,
    hourAngleHours: session.hourAngleHours,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/parser/__tests__/polarAlignment.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/parser/polarAlignment.ts web/src/parser/__tests__/polarAlignment.test.ts
git commit -m "feat(parser): drift core for polar alignment (settling mask, RA endpoint, Dec skip-gaps)"
```

---

### Task 3: PAE total + Alt/Az hour-angle projection

**Files:**
- Modify: `web/src/parser/polarAlignment.ts` (fill in PAE + decomposition)
- Test: `web/src/parser/__tests__/polarAlignment.test.ts` (add cases)

**Interfaces:**
- Produces: completes `PolarAlignment` — `paeTotalArcMin`, `altArcMin`, `azArcMin`, `altTrust`, `azTrust`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/parser/__tests__/polarAlignment.test.ts`:

```ts
describe('computePolarAlignment PAE + decomposition', () => {
  // Dec drift fixture: decraw ramps so drift = 1 px/min; pixelScale 2 → 2"/min.
  const ramp = () => {
    const s = session([
      e({ dt: 0, decraw: 0 }), e({ dt: 60, decraw: 1 }),
      e({ dt: 120, decraw: 2 }), e({ dt: 180, decraw: 3 }),
    ]);
    s.pixelScale = 2;
    return s;
  };

  it('total PAE = 3.8197 * |Dec drift "/min| / cos(dec)', () => {
    const s = ramp();
    s.declination = 0; // cos = 1
    const pa = computePolarAlignment(s);
    expect(pa.paeTotalArcMin).toBeCloseTo(3.8197 * 2, 3); // 1 px/min * 2 "/px = 2 "/min
  });

  it('at HA 0h: all azimuth, altitude untrusted', () => {
    const s = ramp(); s.hourAngleHours = 0;
    const pa = computePolarAlignment(s);
    expect(pa.azArcMin).toBeCloseTo(pa.paeTotalArcMin, 4);
    expect(pa.altArcMin).toBeCloseTo(0, 4);
    expect(pa.azTrust).toBe(true);
    expect(pa.altTrust).toBe(false);
  });

  it('at HA 6h: all altitude, azimuth untrusted', () => {
    const s = ramp(); s.hourAngleHours = 6; // 90 deg
    const pa = computePolarAlignment(s);
    expect(pa.altArcMin).toBeCloseTo(pa.paeTotalArcMin, 4);
    expect(pa.azArcMin).toBeCloseTo(0, 4);
    expect(pa.altTrust).toBe(true);
    expect(pa.azTrust).toBe(false);
  });

  it('at HA 3h (45 deg): both axes trusted and equal', () => {
    const s = ramp(); s.hourAngleHours = 3; // 45 deg
    const pa = computePolarAlignment(s);
    expect(pa.altArcMin).toBeCloseTo(pa.azArcMin!, 4);
    expect(pa.altTrust).toBe(true);
    expect(pa.azTrust).toBe(true);
    expect(Math.hypot(pa.altArcMin!, pa.azArcMin!)).toBeCloseTo(pa.paeTotalArcMin, 4);
  });

  it('null hour angle leaves Alt/Az null and untrusted', () => {
    const s = ramp(); s.hourAngleHours = null;
    const pa = computePolarAlignment(s);
    expect(pa.altArcMin).toBeNull();
    expect(pa.azArcMin).toBeNull();
    expect(pa.altTrust).toBe(false);
    expect(pa.azTrust).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd web && npx vitest run src/parser/__tests__/polarAlignment.test.ts`
Expected: FAIL (paeTotalArcMin is 0, decomposition null).

- [ ] **Step 3: Implement PAE + decomposition**

In `web/src/parser/polarAlignment.ts`, replace the final `return { … }` block of `computePolarAlignment` with:

```ts
  const driftRaPxMin = driftRaPps * 60;
  const driftDecPxMin = driftDecPps * 60;

  const cosDec = Math.cos(session.declination);
  const paeTotalArcMin = Math.abs(cosDec) > 1e-6
    ? (PAE_CONSTANT * Math.abs(driftDecPxMin) * session.pixelScale) / Math.abs(cosDec)
    : 0;

  // Alt/Az hour-angle projection (min-norm). Needs the section hour angle.
  const ha = session.hourAngleHours;
  let altArcMin: number | null = null;
  let azArcMin: number | null = null;
  let altTrust = false;
  let azTrust = false;
  if (ha !== null) {
    const haRad = (ha * 15 * Math.PI) / 180;
    const azSens = Math.abs(Math.cos(haRad)); // azimuth sensitivity (max at meridian)
    const altSens = Math.abs(Math.sin(haRad)); // altitude sensitivity (max at ±6h)
    azArcMin = paeTotalArcMin * azSens;
    altArcMin = paeTotalArcMin * altSens;
    azTrust = azSens >= TRUST_THRESHOLD;
    altTrust = altSens >= TRUST_THRESHOLD;
  }

  return {
    driftRaPxMin,
    driftDecPxMin,
    paeTotalArcMin,
    altArcMin,
    azArcMin,
    altTrust,
    azTrust,
    hourAngleHours: ha,
  };
```

(Delete the temporary `const driftRaPxMin … return { … }` placeholder from Task 2 — replace it entirely with the block above.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/parser/__tests__/polarAlignment.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add web/src/parser/polarAlignment.ts web/src/parser/__tests__/polarAlignment.test.ts
git commit -m "feat(parser): total PAE + hour-angle Alt/Az projection with trust flags"
```

---

### Task 4: Integrate into calcStats (replace broken drift/PAE, expose fields)

**Files:**
- Modify: `web/src/parser/stats.ts` (`SessionStats` + `calcStats`)
- Test: `web/src/parser/__tests__/stats.test.ts` (add field assertions)

**Interfaces:**
- Consumes: `computePolarAlignment` from `./polarAlignment`.
- Produces: `SessionStats` gains `altArcMin`, `azArcMin`, `altTrust`, `azTrust`, `hourAngleHours`; `driftRa`/`driftDec`/`paeArcMin` now correct.

- [ ] **Step 1: Write the failing test**

Append to `web/src/parser/__tests__/stats.test.ts`:

```ts
import { computePolarAlignment } from '../polarAlignment';

describe('calcStats polar-alignment fields', () => {
  it('exposes Alt/Az/trust/HA and drift matching computePolarAlignment', () => {
    const s = newGuideSession('x');
    s.entries = [mkE(1, 0, 0, 0), mkE(2, 60, 0, 1), mkE(3, 120, 0, 2), mkE(4, 180, 0, 3)];
    s.pixelScale = 2; s.declination = 0; s.hourAngleHours = 3;
    const pa = computePolarAlignment(s);
    const st = calcStats(s);
    expect(st.driftDec).toBeCloseTo(pa.driftDecPxMin, 6);
    expect(st.paeArcMin).toBeCloseTo(pa.paeTotalArcMin, 6);
    expect(st.altArcMin).toBeCloseTo(pa.altArcMin!, 6);
    expect(st.azArcMin).toBeCloseTo(pa.azArcMin!, 6);
    expect(st.altTrust).toBe(true);
    expect(st.azTrust).toBe(true);
    expect(st.hourAngleHours).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/parser/__tests__/stats.test.ts`
Expected: FAIL (`altArcMin` etc. undefined on SessionStats).

- [ ] **Step 3: Extend the SessionStats interface**

In `web/src/parser/stats.ts`, add to the `SessionStats` interface (after `paeArcMin: number;`):

```ts
  paeArcMin: number;
  altArcMin: number | null;
  azArcMin: number | null;
  altTrust: boolean;
  azTrust: boolean;
  hourAngleHours: number | null;
```

- [ ] **Step 4: Replace the drift/PAE computation**

In `web/src/parser/stats.ts`:

Add the import at the top (below the existing `import type { GuideSession }`):

```ts
import { computePolarAlignment } from './polarAlignment';
```

Delete the `linregSlope` function (currently lines ~27-39) — it becomes unused.

In `calcStats`, delete the `dts.push(e.dt);` line inside the loop and the `const dts: number[] = [];` declaration (the array is only used for the old drift). Then replace this block:

```ts
  const driftRa = linregSlope(dts, ras) * 60;
  const driftDec = linregSlope(dts, decs) * 60;

  const ellipse = pcaEllipse(ras, decs);

  const driftDecArcsecMin = Math.abs(driftDec) * s.pixelScale;
  const cosDec = Math.cos(s.declination) || 1;
  const paeArcMin = (driftDecArcsecMin * 3.81972) / cosDec;
```

with:

```ts
  const pa = computePolarAlignment(s, mask);
  const driftRa = pa.driftRaPxMin;
  const driftDec = pa.driftDecPxMin;

  const ellipse = pcaEllipse(ras, decs);

  const paeArcMin = pa.paeTotalArcMin;
```

- [ ] **Step 5: Extend the return object**

In `calcStats`, add to the returned object (after `paeArcMin,`):

```ts
    paeArcMin,
    altArcMin: pa.altArcMin,
    azArcMin: pa.azArcMin,
    altTrust: pa.altTrust,
    azTrust: pa.azTrust,
    hourAngleHours: pa.hourAngleHours,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && npx tsc --noEmit && npx vitest run src/parser/__tests__/stats.test.ts`
Expected: tsc clean; PASS (existing tests including "computes drift from a linear ramp" still pass, plus the new field test).

- [ ] **Step 7: Commit**

```bash
git add web/src/parser/stats.ts web/src/parser/__tests__/stats.test.ts
git commit -m "feat(parser): wire corrected drift + polar-alignment fields into calcStats"
```

---

### Task 5: Stoplight band for polar alignment

**Files:**
- Modify: `web/src/components/guidingMetric.ts` (add `polarAlignmentBand`)
- Test: `web/src/components/__tests__/guidingMetric.test.ts` (add cases)

**Interfaces:**
- Produces: `polarAlignmentBand(arcMin: number): Band` (≤2 green, ≤5 yellow, else red).

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/__tests__/guidingMetric.test.ts`:

```ts
import { polarAlignmentBand } from '../guidingMetric';

describe('polarAlignmentBand', () => {
  it('bands by 2′ and 5′ thresholds', () => {
    expect(polarAlignmentBand(0)).toBe('green');
    expect(polarAlignmentBand(2)).toBe('green');
    expect(polarAlignmentBand(2.01)).toBe('yellow');
    expect(polarAlignmentBand(5)).toBe('yellow');
    expect(polarAlignmentBand(5.01)).toBe('red');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/guidingMetric.test.ts`
Expected: FAIL (`polarAlignmentBand` not exported).

- [ ] **Step 3: Implement**

In `web/src/components/guidingMetric.ts`, add at the end of the file:

```ts
// Polar-alignment stoplight: ≤2′ green, 2–5′ yellow, >5′ red (per spec).
export function polarAlignmentBand(arcMin: number): Band {
  if (arcMin <= 2) return 'green';
  if (arcMin <= 5) return 'yellow';
  return 'red';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/__tests__/guidingMetric.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/guidingMetric.ts web/src/components/__tests__/guidingMetric.test.ts
git commit -m "feat(ui): polarAlignmentBand stoplight thresholds"
```

---

### Task 6: i18n strings (en + 5 locales)

**Files:**
- Modify: `web/src/i18n/locales/en/stats.json`
- Modify: `web/src/i18n/locales/es/stats.json`
- Modify: `web/src/i18n/locales/de/stats.json`
- Modify: `web/src/i18n/locales/fr/stats.json`
- Modify: `web/src/i18n/locales/it/stats.json`
- Modify: `web/src/i18n/locales/zh/stats.json`

**Interfaces:**
- Produces: keys `rows.polarAlign`, `pa.tooltip`, `pa.altLowConf`, `pa.azLowConf` in the `stats` namespace. (`PAE`, `RA`, `Dec`, `Alt`, `Az` stay English and are rendered as literals in the component — not keys.)

- [ ] **Step 1: Add the `rows.polarAlign` key and a `pa` block to en**

In `web/src/i18n/locales/en/stats.json`, change the `rows` object to:

```json
  "rows": {
    "total": "Total",
    "polarAlign": "Polar Alignment"
  },
```

and add a top-level `pa` block (e.g. after the `aspectRatioTooltip` line):

```json
  "pa": {
    "tooltip": "Estimated polar-alignment error for this section, from the Dec drift. Altitude and Azimuth are split by hour angle; one section can't fully separate them — \"!\" marks a low-confidence axis.",
    "altLowConf": "Altitude is low-confidence at this hour angle — near the meridian, altitude barely affects Dec drift, so this value can't be measured reliably.",
    "azLowConf": "Azimuth is low-confidence at this hour angle — near ±6h, azimuth barely affects Dec drift, so this value can't be measured reliably."
  },
```

- [ ] **Step 2: Mirror the same keys into the other 5 locales**

Add `"polarAlign"` to each `rows` block and a `pa` block to each file:

`es/stats.json` — `rows.polarAlign`: `"Alineación polar"`; `pa`:
```json
  "pa": {
    "tooltip": "Error estimado de alineación polar de esta sección, a partir de la deriva en Dec. La Altitud y el Acimut se separan según el ángulo horario; una sola sección no puede separarlos del todo — \"!\" marca un eje de baja confianza.",
    "altLowConf": "La Altitud es de baja confianza con este ángulo horario: cerca del meridiano apenas afecta a la deriva en Dec, así que este valor no es fiable.",
    "azLowConf": "El Acimut es de baja confianza con este ángulo horario: cerca de ±6h apenas afecta a la deriva en Dec, así que este valor no es fiable."
  },
```

`de/stats.json` — `rows.polarAlign`: `"Polausrichtung"`; `pa`:
```json
  "pa": {
    "tooltip": "Geschätzter Polausrichtungsfehler dieses Abschnitts aus der Dek-Drift. Höhe und Azimut werden über den Stundenwinkel aufgeteilt; ein einzelner Abschnitt kann sie nicht vollständig trennen — \"!\" kennzeichnet eine Achse mit geringer Zuverlässigkeit.",
    "altLowConf": "Die Höhe ist bei diesem Stundenwinkel wenig zuverlässig — nahe dem Meridian beeinflusst sie die Dek-Drift kaum, daher ist dieser Wert unzuverlässig.",
    "azLowConf": "Der Azimut ist bei diesem Stundenwinkel wenig zuverlässig — nahe ±6h beeinflusst er die Dek-Drift kaum, daher ist dieser Wert unzuverlässig."
  },
```

`fr/stats.json` — `rows.polarAlign`: `"Alignement polaire"`; `pa`:
```json
  "pa": {
    "tooltip": "Erreur d'alignement polaire estimée pour cette section, d'après la dérive en Dec. L'Altitude et l'Azimut sont séparés selon l'angle horaire ; une seule section ne peut pas les séparer entièrement — « ! » indique un axe peu fiable.",
    "altLowConf": "L'Altitude est peu fiable à cet angle horaire — près du méridien, elle n'affecte presque pas la dérive en Dec, donc cette valeur n'est pas fiable.",
    "azLowConf": "L'Azimut est peu fiable à cet angle horaire — près de ±6h, il n'affecte presque pas la dérive en Dec, donc cette valeur n'est pas fiable."
  },
```

`it/stats.json` — `rows.polarAlign`: `"Allineamento polare"`; `pa`:
```json
  "pa": {
    "tooltip": "Errore di allineamento polare stimato per questa sezione, dalla deriva in Dec. Altitudine e Azimut sono separati in base all'angolo orario; una sola sezione non può separarli del tutto — \"!\" indica un asse poco affidabile.",
    "altLowConf": "L'Altitudine è poco affidabile a questo angolo orario — vicino al meridiano incide poco sulla deriva in Dec, quindi questo valore non è affidabile.",
    "azLowConf": "L'Azimut è poco affidabile a questo angolo orario — vicino a ±6h incide poco sulla deriva in Dec, quindi questo valore non è affidabile."
  },
```

`zh/stats.json` — `rows.polarAlign`: `"极轴校准"`; `pa`:
```json
  "pa": {
    "tooltip": "本区段根据 Dec 漂移估算的极轴校准误差。高度与方位按时角拆分；单个区段无法完全分离二者——“!”表示该轴可信度低。",
    "altLowConf": "在此时角下高度方向可信度低——靠近子午线时它对 Dec 漂移几乎没有影响，因此该数值不可靠。",
    "azLowConf": "在此时角下方位方向可信度低——靠近 ±6 小时时它对 Dec 漂移几乎没有影响，因此该数值不可靠。"
  },
```

- [ ] **Step 3: Verify JSON validity + i18n smoke**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: clean (JSON imports compile; no test regressions). If an i18n test enforces key parity across locales, it passes because all six files got the same keys.

- [ ] **Step 4: Commit**

```bash
git add web/src/i18n/locales/*/stats.json
git commit -m "i18n(stats): polar-alignment strings across all locales"
```

---

### Task 7: PolarAlignmentPlot component (SVG target) + geometry helper

**Files:**
- Create: `web/src/components/PolarAlignmentPlot.tsx`
- Test: `web/src/components/__tests__/polarAlignmentPlot.test.ts` (create)

**Interfaces:**
- Consumes: `polarAlignmentBand` from `./guidingMetric`; `useTranslation('stats')`.
- Produces: `paePlotDot(paeTotal, altArcMin, azArcMin, perMin, cx, cy)` (pure, exported, returns `{ x, y, r }`); default export `PolarAlignmentPlot` React component with props `{ paeTotal: number; altArcMin: number | null; azArcMin: number | null; altTrust: boolean; azTrust: boolean; hasHa: boolean }`.

- [ ] **Step 1: Write the failing test (geometry helper)**

Create `web/src/components/__tests__/polarAlignmentPlot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { paePlotDot } from '../PolarAlignmentPlot';

describe('paePlotDot', () => {
  const perMin = 70 / 6; // radius 70 spans 6′
  it('places the dot at distance = total PAE from center', () => {
    const d = paePlotDot(3, 3, 0, perMin, 80, 80); // all azimuth → on +x axis
    expect(Math.hypot(d.x - 80, d.y - 80)).toBeCloseTo(3 * perMin, 4);
    expect(d.x).toBeGreaterThan(80); // azimuth → right
    expect(d.y).toBeCloseTo(80, 4);
  });
  it('all-altitude points straight up', () => {
    const d = paePlotDot(3, 3, 0.0001, perMin, 80, 80); // alt dominates
    expect(d.y).toBeLessThan(80); // up
  });
  it('clamps distance to the 6′ edge', () => {
    const d = paePlotDot(12, 12, 0, perMin, 80, 80);
    expect(Math.hypot(d.x - 80, d.y - 80)).toBeCloseTo(6 * perMin, 4);
  });
  it('centers the dot when there is no split (null contributions)', () => {
    const d = paePlotDot(3, null, null, perMin, 80, 80);
    expect(d.x).toBeCloseTo(80, 4);
    expect(d.y).toBeCloseTo(80, 4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/polarAlignmentPlot.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component + helper**

Create `web/src/components/PolarAlignmentPlot.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { polarAlignmentBand } from './guidingMetric';

// Geometry: viewBox 160×190, target centered at (CX,CY), radius R spans 6′.
const CX = 80, CY = 80, R = 70;
const PER_MIN = R / 6;
const GREEN_R = 2 * PER_MIN; // ≤2′
const YELLOW_R = 5 * PER_MIN; // ≤5′
const MAX_MIN = 6;

const BAND_HEX: Record<'green' | 'yellow' | 'red', string> = {
  green: '#10b981', yellow: '#facc15', red: '#ef4444',
};

// Pure: dot position for the total error + Alt/Az split. Distance = total PAE
// (clamped to 6′); angle = atan2(alt, az) in the upper-right quadrant (magnitude
// only — directional placement is a future phase). Null split → centered.
export function paePlotDot(
  paeTotal: number, altArcMin: number | null, azArcMin: number | null,
  perMin: number, cx: number, cy: number,
): { x: number; y: number; r: number } {
  const r = Math.min(paeTotal, MAX_MIN) * perMin;
  if (altArcMin === null || azArcMin === null || paeTotal <= 0) {
    return { x: cx, y: cy, r };
  }
  const ang = Math.atan2(altArcMin, azArcMin); // both ≥ 0 → first quadrant
  return { x: cx + Math.cos(ang) * r, y: cy - Math.sin(ang) * r, r };
}

// Even-odd donut between outer radius ro and inner radius ri.
const donut = (ro: number, ri: number) =>
  `M${CX - ro},${CY} a${ro},${ro} 0 1 0 ${2 * ro},0 a${ro},${ro} 0 1 0 ${-2 * ro},0 Z ` +
  `M${CX - ri},${CY} a${ri},${ri} 0 1 0 ${2 * ri},0 a${ri},${ri} 0 1 0 ${-2 * ri},0 Z`;

interface Props {
  paeTotal: number;
  altArcMin: number | null;
  azArcMin: number | null;
  altTrust: boolean;
  azTrust: boolean;
  hasHa: boolean;
}

export default function PolarAlignmentPlot({ paeTotal, altArcMin, azArcMin, altTrust, azTrust, hasHa }: Props) {
  const { t } = useTranslation('stats');
  const band = polarAlignmentBand(paeTotal);
  const dot = paePlotDot(paeTotal, altArcMin, azArcMin, PER_MIN, CX, CY);
  const showAzWarn = hasHa && !azTrust;
  const showAltWarn = hasHa && !altTrust;

  return (
    <svg viewBox="0 0 160 190" width="150" height="178" role="img" aria-label={t('pa.tooltip')}>
      <title>{t('pa.tooltip')}</title>
      <path fillRule="evenodd" fill={BAND_HEX.red} fillOpacity="0.18" d={donut(R, YELLOW_R)} />
      <path fillRule="evenodd" fill={BAND_HEX.yellow} fillOpacity="0.22" d={donut(YELLOW_R, GREEN_R)} />
      <circle cx={CX} cy={CY} r={GREEN_R} fill={BAND_HEX.green} fillOpacity="0.24" />
      <line x1={CX - R} y1={CY} x2={CX + R} y2={CY} stroke="#64748b" strokeOpacity="0.45" />
      <line x1={CX} y1={CY - R} x2={CX} y2={CY + R} stroke="#64748b" strokeOpacity="0.45" />
      <text x={CX} y={CY - R - 3} fill="#94a3b8" fontSize="9" textAnchor="middle">Alt</text>
      <text x={CX + R + 1} y={CY - 3} fill="#94a3b8" fontSize="9" textAnchor="end">Az</text>
      {paeTotal > 0 && (
        <>
          <line x1={CX} y1={CY} x2={dot.x} y2={dot.y} stroke="#e2e8f0" strokeWidth="2" />
          <circle cx={dot.x} cy={dot.y} r="5" fill={BAND_HEX[band]} stroke="#fff" strokeWidth="1.4" />
        </>
      )}
      <text x={CX} y={182} fill={BAND_HEX[band]} fontSize="15" fontWeight="700" textAnchor="middle">
        {paeTotal.toFixed(1)}′
      </text>
      {showAzWarn && (
        <g>
          <circle cx={CX + R * 0.62} cy={CY - 9} r="8" fill="#facc15" />
          <text x={CX + R * 0.62} y={CY - 5} fontSize="12" fontWeight="800" fill="#1f2937" textAnchor="middle">!</text>
          <title>{t('pa.azLowConf')}</title>
        </g>
      )}
      {showAltWarn && (
        <g>
          <circle cx={CX + 9} cy={CY - R * 0.62} r="8" fill="#facc15" />
          <text x={CX + 9} y={CY - R * 0.62 + 4} fontSize="12" fontWeight="800" fill="#1f2937" textAnchor="middle">!</text>
          <title>{t('pa.altLowConf')}</title>
        </g>
      )}
    </svg>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx tsc --noEmit && npx vitest run src/components/__tests__/polarAlignmentPlot.test.ts`
Expected: tsc clean; PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PolarAlignmentPlot.tsx web/src/components/__tests__/polarAlignmentPlot.test.ts
git commit -m "feat(ui): PolarAlignmentPlot target graphic + geometry helper"
```

---

### Task 8: StatsGrid — Polar Alignment area, remove stale cells, render plot

**Files:**
- Modify: `web/src/components/StatsGrid.tsx`

**Interfaces:**
- Consumes: `SessionStats` PA fields (Task 4), `polarAlignmentBand` + `BAND_CLASSES` (Task 5/existing), `PolarAlignmentPlot` (Task 7), `pa.*`/`rows.polarAlign` i18n (Task 6).

- [ ] **Step 1: Update imports**

In `web/src/components/StatsGrid.tsx`, replace:

```ts
import { guidingMetric } from './guidingMetric';
```

with:

```ts
import { guidingMetric, polarAlignmentBand, BAND_CLASSES } from './guidingMetric';
import PolarAlignmentPlot from './PolarAlignmentPlot';
```

- [ ] **Step 2: Remove the stale PAE cell and the per-axis drift cells**

In the `common` array, delete the line:

```ts
    [t('guide.pae'), `${fmt(s.paeArcMin, 2)}′`],
```

In `raRow`, delete:

```ts
    [t('guide.drift'), drift(s.driftRa)],
```

In `decRow`, delete:

```ts
    [t('guide.drift'), drift(s.driftDec)],
```

- [ ] **Step 3: Build the Polar Alignment area + plot data**

After the `decRow` declaration (before `const copy = …`), add:

```ts
  const hasHa = s.hourAngleHours !== null;
  const paBand = polarAlignmentBand(s.paeArcMin);
  // "!" marker shown on a low-confidence axis (only meaningful when HA exists).
  const altWarn = hasHa && !s.altTrust;
  const azWarn = hasHa && !s.azTrust;
  const fmtPa = (n: number | null) => (n === null ? '—' : `${fmt(n, 2)}′`);
```

- [ ] **Step 4: Render the area + plot**

Replace the component's `return ( … )` block with:

```tsx
  return (
    <div className="flex flex-wrap items-start gap-4 px-4 py-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Row label={t('rows.total')} items={common} />
        <Row label="RA" color="text-sky-400" items={raRow} />
        <Row label="Dec" color="text-rose-400" items={decRow} />

        {/* Polar Alignment — its own subtitled area beneath total/ra/dec. */}
        <div className="mt-1 border-t border-slate-700/60 pt-1">
          <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-violet-400" title={t('pa.tooltip')}>
            {t('rows.polarAlign')}
          </div>
          {/* Line 1: total PAE, stoplight-coloured badge */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${BAND_CLASSES[paBand]}`}>
              {`${fmt(s.paeArcMin, 2)}′`}
            </span>
          </div>
          {/* Line 2: Alt / Az contributions with low-confidence markers */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">Alt</span>
              <span className="font-mono text-slate-100">{fmtPa(s.altArcMin)}</span>
              {altWarn && <span className="cursor-help font-bold text-amber-400" title={t('pa.altLowConf')}>!</span>}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">Az</span>
              <span className="font-mono text-slate-100">{fmtPa(s.azArcMin)}</span>
              {azWarn && <span className="cursor-help font-bold text-amber-400" title={t('pa.azLowConf')}>!</span>}
            </span>
          </div>
          {/* Line 3: RA / Dec drift (input to the calculation) */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <Cell k="RA" v={drift(s.driftRa)} />
            <Cell k="Dec" v={drift(s.driftDec)} />
          </div>
        </div>
      </div>

      <PolarAlignmentPlot
        paeTotal={s.paeArcMin}
        altArcMin={s.altArcMin}
        azArcMin={s.azArcMin}
        altTrust={s.altTrust}
        azTrust={s.azTrust}
        hasHa={hasHa}
      />
    </div>
  );
```

- [ ] **Step 5: Verify the build + types**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass. (`guide.pae`/`guide.drift` keys are now unused by StatsGrid but remain in the locale files — harmless; leave them.)

- [ ] **Step 6: Commit**

```bash
git add web/src/components/StatsGrid.tsx
git commit -m "feat(ui): Polar Alignment area + target plot in the guiding stats footer"
```

---

### Task 9: Full verification, manual sample-log check, and PR

**Files:** none (verification only)

- [ ] **Step 1: Full type-check + test suite**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; entire suite green.

- [ ] **Step 2: Manual validation against the local sample log**

Start the dev server (`cd web && npm run dev`), load `sample data/polarAlignment/PHD2_GuideLog_2026-06-09_210610.txt`, and select the guiding sections. Confirm the Polar Alignment area shows (within display rounding):
- **Segment 8:** PAE ≈ 4.0′ (yellow), Dec drift ≈ −0.58″/min, RA ≈ −0.22″/min.
- **Segment 10:** PAE ≈ 3.1′ (yellow), Alt ≈ 3.1′, Az ≈ 0.0′ with a "!" on Az (HA ≈ −6h), Dec ≈ −0.45″/min, RA ≈ −0.08″/min.
- **Segment 15:** PAE ≈ 1.2′ (green), no "!" badges, Dec ≈ −0.17″/min.
Confirm the target plot dot lands in the matching stoplight ring and hovering "!" shows the tooltip.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/polar-alignment
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "feat: polar alignment estimate (per-section)" --body "Implements the Polar Alignment spec (docs/superpowers/specs/2026-06-17-polar-alignment-design.md): per-section total PAE + Alt/Az split + RA/Dec drift in the guiding stats footer, with a stoplight target-plot graphic. Replaces the previously-broken (≈0 for guided sessions) drift/PAE computation. Validated against sample segments 8/10/15."
```

- [ ] **Step 4: Auto-merge per policy once green**

After `tsc --noEmit` + `vitest run` are confirmed clean on the branch (coding PR):

```bash
gh pr merge <num> --squash --delete-branch
git checkout main && git pull --ff-only
```

---

## Self-Review

**Spec coverage:**
- §2 algorithm → Tasks 2–4. §3.1 validation → Task 9 manual check. §4 decomposition + trust → Task 3. §5 parsing (HA/pier) → Task 1; settling exclusion → Task 2. §6 calcStats replacement + fields → Task 4. §7 UI (PA area, removed cells, plot, i18n, band) → Tasks 5–8. §8 edge cases: missing HA → null Alt/Az + centered dot (Tasks 3/7/8), too-few-frames → drift 0 (Task 2 guards `lastIdx>firstIdx`), cos≈0 guard (Task 3), calibration sections → StatsGrid already returns null for non-guiding. §9 testing → unit tests each task + Task 9 manual. §10 future phases → not implemented (correct).
- Gap: extreme-declination "warning" (§8) is only guarded (PAE→0), not surfaced as a distinct message. Acceptable for v1; the value shows 0/—. No extra task.

**Placeholder scan:** No TBD/TODO; every code step is complete; commands have expected output.

**Type consistency:** `PolarAlignment` fields (Task 2/3) match `SessionStats` additions (Task 4) and `PolarAlignmentPlot` props (Task 7). `polarAlignmentBand` (Task 5) returns `Band` consumed via `BAND_CLASSES` (Task 8). `paePlotDot` signature consistent between Task 7 test and impl. i18n keys (`rows.polarAlign`, `pa.tooltip`, `pa.altLowConf`, `pa.azLowConf`) are defined in Task 6 and consumed in Tasks 7–8.
