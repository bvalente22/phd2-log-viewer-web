# Polar Alignment Accuracy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Sharpen the per-section Alt/Az split with an effective (drift-weighted mean) hour angle, add a whole-log "All Sections" least-squares solve with a confidence rating, surface both in one toggling footer area, and narrow all PA tooltips.

**Architecture:** `computePolarAlignment` gains an effective HA (mean HA over included frames) used in its Alt/Az projection. A new pure `computeGlobalPolarAlignment(log, masks)` solves Alt & Az across qualifying sections by 2×2 least squares (pier-side normalized) and rates confidence from HA spread + residual. `StatsGrid` renders one toggling PA area (Section ⟷ All Sections); `PolarAlignmentPlot` shows whichever mode. A shared `wrapTip` narrows all `title` tooltips.

**Tech Stack:** React 18 + TypeScript, Zustand, Vitest, i18next (6 locales).

## Global Constraints

- Branch `feat/pa-accuracy`; `main` only via PR per `CLAUDE.md`. Push after commits; open the PR in the final task.
- **Environment (NAS):** run the toolchain from `G:` via `node`, `cd` in every command: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit` and `… node node_modules/vitest/vitest.mjs run <files>`. No `npx`/`npm install`. Retry once on a transient `@vitejs/plugin-react` error. Cold vitest ≈ 30s.
- `PAE_CONSTANT = 3.8197`. `SIDEREAL_RATE = 1.0027379`. Effective HA = `hourAngleHours + (meanIncludedDtSec/3600)*SIDEREAL_RATE`. Total PAE does NOT change (HA-independent).
- Global model: `e_i = A·cos(H_i) + E·sin(H_i)`, `e_i = 3.8197·(signed driftDec px/min · pixelScale)/cos(dec_i)`, H_i = effective HA radians. Pier-side: negate `e_i` for sections whose `pierSide` differs from the first qualifying section's.
- Confidence: `—` if <2 qualifying sections or HA spread <1.0h or singular; `high` if spread ≥3.0h and relResidual <0.25; `medium` if spread ≥1.5h and relResidual <0.5; else `low`. `MIN_GLOBAL_FRAMES = 30`.
- **All `title` tooltips wrapped narrow** via the shared `wrapTip` (≈44 chars/line) — new and existing PA ones. PHD2 jargon (RA/Dec/Alt/Az/HA) stays English.

---

### Task 1: Shared `wrapTip` tooltip helper

**Files:**
- Modify: `web/src/i18n/format.ts`
- Modify: `web/src/components/ImageImpact.tsx` (use the shared helper)
- Test: `web/src/i18n/__tests__/format.test.ts` (create or append)

**Interfaces:**
- Produces: `wrapTip(text: string, max = 44): string` — inserts newlines so a native `title` renders narrow-and-tall; hard-breaks tokens longer than `max`.

- [ ] **Step 1: Write the failing test**

Create `web/src/i18n/__tests__/format.test.ts` (if absent) with:

```ts
import { describe, it, expect } from 'vitest';
import { wrapTip } from '../format';

describe('wrapTip', () => {
  it('wraps to <= max chars per line on word boundaries', () => {
    const out = wrapTip('the quick brown fox jumps over', 10);
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(10);
    expect(out).toContain('\n');
  });
  it('hard-breaks a token longer than max', () => {
    const out = wrapTip('supercalifragilistic', 6);
    expect(out.split('\n').every((l) => l.length <= 6)).toBe(true);
  });
  it('defaults to 44', () => {
    expect(wrapTip('x'.repeat(50)).split('\n').length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/vitest/vitest.mjs run src/i18n/__tests__/format.test.ts`
Expected: FAIL (`wrapTip` not exported).

- [ ] **Step 3: Add `wrapTip` to format.ts**

Append to `web/src/i18n/format.ts`:

```ts
/**
 * Word-wrap to a max line width by inserting newlines so a native `title`
 * tooltip renders narrow-and-tall instead of one very long line. Hard-breaks a
 * single token longer than max (e.g. CJK runs with no spaces). Keep tooltips
 * narrow across the app (≈44 chars) — see CLAUDE.md "UI conventions — tooltips".
 */
export function wrapTip(text: string, max = 44): string {
  const out: string[] = [];
  let line = '';
  const push = () => { if (line) { out.push(line); line = ''; } };
  for (const w of text.split(' ')) {
    let word = w;
    while (word.length > max) { push(); out.push(word.slice(0, max)); word = word.slice(max); }
    if (line && line.length + 1 + word.length > max) push();
    line = line ? `${line} ${word}` : word;
  }
  push();
  return out.join('\n');
}
```

- [ ] **Step 4: Point ImageImpact at the shared helper**

In `web/src/components/ImageImpact.tsx`: delete the local `function wrap(text, max = 52) {…}` (lines ~17-32) and its uses; import `wrapTip` from `../i18n/format` and replace `wrap(` call sites with `wrapTip(` (ImageImpact passed no explicit max in most calls; where it passed `52`, drop the arg to use the 44 default, or keep its existing width by passing `wrapTip(text, 52)` — keep 52 for ImageImpact to avoid reflowing its approved tooltips). Add `import { fmtNumber, wrapTip } from '../i18n/format';` (merge with the existing format import).

- [ ] **Step 5: Run tests + tsc**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run src/i18n/__tests__/format.test.ts`
Expected: tsc clean; format tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/i18n/format.ts web/src/i18n/__tests__/format.test.ts web/src/components/ImageImpact.tsx
git commit -m "feat(i18n): shared wrapTip tooltip helper; ImageImpact uses it"
```

---

### Task 2: Effective hour angle (#4) in `computePolarAlignment`

**Files:**
- Modify: `web/src/parser/polarAlignment.ts`
- Test: `web/src/parser/__tests__/polarAlignment.test.ts`

**Interfaces:**
- Produces: `PolarAlignment` gains `effectiveHaHours: number | null` and `includedCount: number`. The Alt/Az projection uses the effective HA.

- [ ] **Step 1: Write the failing test**

Append to `web/src/parser/__tests__/polarAlignment.test.ts` (it has the `e(...)`/`session(...)` helpers):

```ts
describe('effective hour angle', () => {
  it('uses the drift-weighted mean HA for the Alt/Az split (total PAE unchanged)', () => {
    // 0..600s of frames, Dec ramps so drift is nonzero. Start HA = -6h; over
    // 600s the effective (mean) HA moves toward the meridian, so |cos| grows
    // and the azimuth contribution rises above the start-HA value.
    const rows = [];
    for (let k = 0; k <= 10; k++) rows.push(e({ dt: k * 60, decraw: k * 0.1 }));
    const s = session(rows, { pixelScale: 5, declination: 0, hourAngleHours: -6 });
    const pa = computePolarAlignment(s);
    // effective HA = -6 + (mean dt 300s /3600)*1.0027 ≈ -5.916h
    expect(pa.effectiveHaHours).toBeCloseTo(-6 + (300 / 3600) * 1.0027379, 4);
    // azimuth contribution is now > 0 (start HA -6h would give |cos|≈0)
    expect(pa.azArcMin!).toBeGreaterThan(0);
    expect(pa.includedCount).toBe(11);
  });
  it('effectiveHaHours is null when hourAngleHours is null', () => {
    const s = session([e({ dt: 0, decraw: 0 }), e({ dt: 60, decraw: 1 })], { hourAngleHours: null });
    expect(computePolarAlignment(s).effectiveHaHours).toBeNull();
  });
});
```

(If the `session(...)` helper doesn't accept an options arg with `pixelScale`/`declination`/`hourAngleHours`, set them on the returned session before calling — adapt to the helper already in that file.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/vitest/vitest.mjs run src/parser/__tests__/polarAlignment.test.ts`
Expected: FAIL (`effectiveHaHours`/`includedCount` undefined).

- [ ] **Step 3: Add the constant + interface fields**

In `web/src/parser/polarAlignment.ts`, after `export const TRUST_THRESHOLD = 0.30;` add:

```ts
// HA advances at the sidereal rate (HA hours per solar hour).
export const SIDEREAL_RATE = 1.0027379;
```

Add to the `PolarAlignment` interface (after `hourAngleHours`):

```ts
  hourAngleHours: number | null;
  effectiveHaHours: number | null;
  includedCount: number;
```

- [ ] **Step 4: Compute effective HA + included count, use it in the projection**

In `computePolarAlignment`, replace the included-index scan to also collect the mean dt and count:

Replace:
```ts
  let firstIdx = -1, lastIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    if (included(i)) { if (firstIdx < 0) firstIdx = i; lastIdx = i; }
  }
```
with:
```ts
  let firstIdx = -1, lastIdx = -1, includedCount = 0, dtSum = 0;
  for (let i = 0; i < entries.length; i++) {
    if (included(i)) { if (firstIdx < 0) firstIdx = i; lastIdx = i; includedCount += 1; dtSum += entries[i].dt; }
  }
```

Then replace the projection block (currently `const ha = session.hourAngleHours; … if (ha !== null) { const haRad = (ha * 15 * Math.PI) / 180; …}`) with one that derives the effective HA:

```ts
  // Alt/Az hour-angle projection (min-norm), using the section's drift-weighted
  // mean (effective) hour angle rather than the start HA.
  const ha = session.hourAngleHours;
  let effectiveHaHours: number | null = null;
  let altArcMin: number | null = null;
  let azArcMin: number | null = null;
  let altTrust = false;
  let azTrust = false;
  if (ha !== null && includedCount > 0) {
    const meanDt = dtSum / includedCount;
    effectiveHaHours = ha + (meanDt / 3600) * SIDEREAL_RATE;
    const haRad = (effectiveHaHours * 15 * Math.PI) / 180;
    const azSens = Math.abs(Math.cos(haRad));
    const altSens = Math.abs(Math.sin(haRad));
    azArcMin = paeTotalArcMin * azSens;
    altArcMin = paeTotalArcMin * altSens;
    azTrust = azSens >= TRUST_THRESHOLD;
    altTrust = altSens >= TRUST_THRESHOLD;
  }
```

Add `effectiveHaHours` and `includedCount` to the returned object (alongside `hourAngleHours`).

- [ ] **Step 5: Run tests + tsc**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run src/parser/__tests__/polarAlignment.test.ts`
Expected: tsc clean; all pass (existing cases still pass — total PAE unchanged; HA=0 cases: meanDt small so effective≈start).

- [ ] **Step 6: Commit**

```bash
git add web/src/parser/polarAlignment.ts web/src/parser/__tests__/polarAlignment.test.ts
git commit -m "feat(parser): effective (mean) hour angle for the Alt/Az split"
```

---

### Task 3: Whole-log solve — `globalPolarAlignment.ts` (#5)

**Files:**
- Create: `web/src/parser/globalPolarAlignment.ts`
- Test: `web/src/parser/__tests__/globalPolarAlignment.test.ts`

**Interfaces:**
- Consumes: `computePolarAlignment` (Task 2), `GuideLog`, `PAE_CONSTANT`.
- Produces: `GlobalConfidence = 'high'|'medium'|'low'|'insufficient'`; `GlobalPolarAlignment` `{ totalArcMin, altArcMin, azArcMin, confidence, sectionCount, haSpreadHours, relResidual }`; `computeGlobalPolarAlignment(log: GuideLog, masks?: Map<number, Uint8Array>): GlobalPolarAlignment`.

- [ ] **Step 1: Write the failing test**

Create `web/src/parser/__tests__/globalPolarAlignment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeGlobalPolarAlignment } from '../globalPolarAlignment';
import { PAE_CONSTANT } from '../polarAlignment';
import { newGuideLog, newGuideSession, type GuideLog, type GuideEntry } from '../types';

// Build a guiding session whose Dec drift yields a chosen signed effective error
// `e` at hour angle `haHours`, declination 0, pixelScale 1, with `n` frames.
function sectionFor(e: number, haHours: number, n = 60, pier = 'West'): ReturnType<typeof newGuideSession> {
  const s = newGuideSession('x');
  s.pixelScale = 1; s.declination = 0; s.hourAngleHours = haHours; s.pierSide = pier;
  // e = 3.8197 * driftDecPxMin (dec=0, ps=1). driftDec px/min over the frames:
  // make decraw a clean linear ramp so the cumulative-Dec slope = driftDec.
  const driftPxMin = e / PAE_CONSTANT;            // px/min
  const driftPxSec = driftPxMin / 60;
  const dtStep = 1;                                // 1s frames → mean dt ~ (n-1)/2 s (tiny HA shift)
  const rows: GuideEntry[] = [];
  for (let k = 0; k < n; k++) {
    rows.push({
      frame: k + 1, dt: k * dtStep, mount: 'MOUNT', included: true, guiding: true,
      dx: 0, dy: 0, raraw: 0, decraw: k * dtStep * driftPxSec, raguide: 0, decguide: 0,
      radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '',
    });
  }
  s.entries = rows;
  return s;
}

function logOf(sessions: ReturnType<typeof newGuideSession>[]): GuideLog {
  const log = newGuideLog();
  sessions.forEach((s) => { log.sessions.push(s); log.sections.push({ type: 'GUIDING', idx: log.sessions.length - 1 }); });
  return log;
}

describe('computeGlobalPolarAlignment', () => {
  it('recovers Alt & Az from sections at different hour angles', () => {
    // True A (az) = 1.5', E (alt) = 2.0'. e_i = A cos H + E sin H.
    const A = 1.5, E = 2.0;
    const has = [-6, -4, -2, 0, 2]; // hours, wide spread
    const sessions = has.map((h) => {
      const Hr = (h * 15 * Math.PI) / 180;
      const e = A * Math.cos(Hr) + E * Math.sin(Hr);
      return sectionFor(e, h);
    });
    const g = computeGlobalPolarAlignment(logOf(sessions));
    expect(g.azArcMin).toBeCloseTo(1.5, 1);
    expect(g.altArcMin).toBeCloseTo(2.0, 1);
    expect(g.totalArcMin).toBeCloseTo(Math.hypot(1.5, 2.0), 1);
    expect(g.confidence).toBe('high');
    expect(g.sectionCount).toBe(5);
  });

  it('pier-side flip is normalized (flipped section does not break the solve)', () => {
    const A = 1.0, E = 1.5;
    const has = [-5, -1, 3];
    const sessions = has.map((h, i) => {
      const Hr = (h * 15 * Math.PI) / 180;
      let e = A * Math.cos(Hr) + E * Math.sin(Hr);
      const pier = i === 2 ? 'East' : 'West';
      if (pier === 'East') e = -e;     // the log would record the flipped sign
      return sectionFor(e, h, 60, pier);
    });
    const g = computeGlobalPolarAlignment(logOf(sessions));
    expect(g.azArcMin).toBeCloseTo(1.0, 1);
    expect(g.altArcMin).toBeCloseTo(1.5, 1);
  });

  it('reports insufficient when sections share one hour angle', () => {
    const sessions = [sectionFor(1, -6), sectionFor(1.1, -6), sectionFor(0.9, -6)];
    const g = computeGlobalPolarAlignment(logOf(sessions));
    expect(g.confidence).toBe('insufficient');
  });

  it('skips sections with too few frames', () => {
    const sessions = [sectionFor(2, -6, 60), sectionFor(2, 0, 10)]; // 2nd has 10 < MIN_GLOBAL_FRAMES
    const g = computeGlobalPolarAlignment(logOf(sessions));
    expect(g.sectionCount).toBe(1);
    expect(g.confidence).toBe('insufficient');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/vitest/vitest.mjs run src/parser/__tests__/globalPolarAlignment.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the solver**

Create `web/src/parser/globalPolarAlignment.ts`:

```ts
import type { GuideLog } from './types';
import { computePolarAlignment, PAE_CONSTANT } from './polarAlignment';

export const MIN_GLOBAL_FRAMES = 30;

export type GlobalConfidence = 'high' | 'medium' | 'low' | 'insufficient';

export interface GlobalPolarAlignment {
  totalArcMin: number;
  altArcMin: number;
  azArcMin: number;
  confidence: GlobalConfidence;
  sectionCount: number;
  haSpreadHours: number;
  relResidual: number;
}

const INSUFFICIENT: GlobalPolarAlignment = {
  totalArcMin: 0, altArcMin: 0, azArcMin: 0,
  confidence: 'insufficient', sectionCount: 0, haSpreadHours: 0, relResidual: 0,
};

export function computeGlobalPolarAlignment(
  log: GuideLog,
  masks?: Map<number, Uint8Array>,
): GlobalPolarAlignment {
  // Collect qualifying guiding sections: determinable PAE, enough frames, has HA.
  type Pt = { e: number; H: number; haHours: number; pier: string | null };
  const pts: Pt[] = [];
  for (const sec of log.sections) {
    if (sec.type !== 'GUIDING') continue;
    const session = log.sessions[sec.idx];
    const pa = computePolarAlignment(session, masks?.get(sec.idx));
    if (!pa.paeDeterminable || pa.includedCount < MIN_GLOBAL_FRAMES || pa.effectiveHaHours === null) continue;
    const cosDec = Math.cos(session.declination);
    if (Math.abs(cosDec) <= 1e-6) continue;
    const e = (PAE_CONSTANT * (pa.driftDecPxMin * session.pixelScale)) / cosDec; // signed
    const haHours = pa.effectiveHaHours;
    const H = (haHours * 15 * Math.PI) / 180;
    pts.push({ e, H, haHours, pier: session.pierSide });
  }

  if (pts.length < 2) return { ...INSUFFICIENT, sectionCount: pts.length };

  // Pier-side normalization: a meridian flip inverts the measured Dec-drift sign.
  const refPier = pts[0].pier;
  for (const p of pts) if (p.pier != null && refPier != null && p.pier !== refPier) p.e = -p.e;

  const haHoursArr = pts.map((p) => p.haHours);
  const haSpreadHours = Math.max(...haHoursArr) - Math.min(...haHoursArr);

  // 2x2 normal equations for e = A cos H + E sin H.
  let Scc = 0, Scs = 0, Sss = 0, bc = 0, bs = 0;
  for (const { e, H } of pts) {
    const c = Math.cos(H), s = Math.sin(H);
    Scc += c * c; Scs += c * s; Sss += s * s; bc += e * c; bs += e * s;
  }
  const det = Scc * Sss - Scs * Scs;
  if (haSpreadHours < 1.0 || Math.abs(det) < 1e-9) {
    return { ...INSUFFICIENT, sectionCount: pts.length, haSpreadHours };
  }
  const A = (bc * Sss - bs * Scs) / det; // azimuth (signed)
  const E = (bs * Scc - bc * Scs) / det; // altitude (signed)

  // Residual.
  let sse = 0;
  for (const { e, H } of pts) {
    const r = e - (A * Math.cos(H) + E * Math.sin(H));
    sse += r * r;
  }
  const residualRms = Math.sqrt(sse / pts.length);
  const totalArcMin = Math.hypot(A, E);
  const relResidual = residualRms / Math.max(totalArcMin, 0.5);

  let confidence: GlobalConfidence;
  if (haSpreadHours >= 3.0 && relResidual < 0.25) confidence = 'high';
  else if (haSpreadHours >= 1.5 && relResidual < 0.5) confidence = 'medium';
  else confidence = 'low';

  return {
    totalArcMin,
    altArcMin: Math.abs(E),
    azArcMin: Math.abs(A),
    confidence,
    sectionCount: pts.length,
    haSpreadHours,
    relResidual,
  };
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run src/parser/__tests__/globalPolarAlignment.test.ts`
Expected: tsc clean; 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/parser/globalPolarAlignment.ts web/src/parser/__tests__/globalPolarAlignment.test.ts
git commit -m "feat(parser): whole-log polar-alignment least-squares solve + confidence"
```

---

### Task 4: Expose `effectiveHaHours` on `SessionStats`

**Files:**
- Modify: `web/src/parser/stats.ts`
- Test: `web/src/parser/__tests__/stats.test.ts`

**Interfaces:**
- Produces: `SessionStats.effectiveHaHours: number | null` (from `pa.effectiveHaHours`), for the section HA tooltip.

- [ ] **Step 1: Write the failing test**

Append to `web/src/parser/__tests__/stats.test.ts`:

```ts
it('exposes effectiveHaHours from computePolarAlignment', () => {
  const s = newGuideSession('x');
  s.entries = [mkE(1, 0, 0, 0), mkE(2, 600, 0, 1)];
  s.hourAngleHours = -3;
  const st = calcStats(s);
  expect(st.effectiveHaHours).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/vitest/vitest.mjs run src/parser/__tests__/stats.test.ts`
Expected: FAIL (`effectiveHaHours` undefined on SessionStats).

- [ ] **Step 3: Add the field**

In `web/src/parser/stats.ts`, add to the `SessionStats` interface (after `hourAngleHours`):

```ts
  hourAngleHours: number | null;
  effectiveHaHours: number | null;
```

and to the returned object (after `hourAngleHours: pa.hourAngleHours,`):

```ts
    hourAngleHours: pa.hourAngleHours,
    effectiveHaHours: pa.effectiveHaHours,
```

- [ ] **Step 4: Run tests + tsc**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run src/parser/__tests__/stats.test.ts`
Expected: tsc clean; pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/parser/stats.ts web/src/parser/__tests__/stats.test.ts
git commit -m "feat(parser): expose effectiveHaHours on SessionStats"
```

---

### Task 5: i18n — confidence, mode, HA tooltip (6 locales)

**Files:**
- Modify: `web/src/i18n/locales/{en,es,de,fr,it,zh}/stats.json`

**Interfaces:**
- Produces (in `stats`): `pa.modeSection`="Section", `pa.modeAll`="All Sections", `pa.confidence`="Confidence", `pa.confHigh/Medium/Low/Insufficient`, `pa.confTipHigh/Medium/Low/Insufficient`, `pa.effectiveHaTip`, `pa.allTip` (the All-Sections plot tooltip). Reuse existing `pa.tooltip`, `pa.altLowConf`, `pa.azLowConf`.

- [ ] **Step 1: Add keys to `en/stats.json`** inside the `pa` block:

```json
    "modeSection": "Section",
    "modeAll": "All Sections",
    "confidence": "Confidence",
    "confHigh": "High",
    "confMedium": "Medium",
    "confLow": "Low",
    "confInsufficient": "—",
    "confTipHigh": "High confidence: sections span {{spread}}h of hour angle with a low residual, so Alt and Az are well separated.",
    "confTipMedium": "Medium confidence: limited hour-angle spread ({{spread}}h) or some residual; Alt/Az separation is fair.",
    "confTipLow": "Low confidence: narrow hour-angle spread or a large residual — Alt/Az are weakly separated (a mid-session re-align would also cause this).",
    "confTipInsufficient": "Not enough sections at different hour angles to solve Alt vs Az across the log.",
    "effectiveHaTip": "Alt/Az split uses this section's mean hour angle (~{{ha}}h), advanced at the sidereal rate over the included frames.",
    "allTip": "Whole-log polar alignment from a least-squares fit across {{count}} sections at different hour angles."
```

- [ ] **Step 2: Mirror into es/de/fr/it/zh** (translate; keep RA/Dec/Alt/Az/HA English; `confInsufficient` stays "—" in all). Use these per-locale strings:

`es`: modeSection "Sección", modeAll "Todas las secciones", confidence "Confianza", confHigh "Alta", confMedium "Media", confLow "Baja", confInsufficient "—", confTipHigh "Confianza alta: las secciones abarcan {{spread}}h de ángulo horario con bajo residual; Alt y Az están bien separados.", confTipMedium "Confianza media: poco rango de ángulo horario ({{spread}}h) o algún residual; la separación Alt/Az es aceptable.", confTipLow "Confianza baja: rango de ángulo horario estrecho o residual grande — Alt/Az se separan mal (un reajuste a mitad de sesión también lo causaría).", confTipInsufficient "No hay suficientes secciones a distintos ángulos horarios para separar Alt y Az en el registro.", effectiveHaTip "La división Alt/Az usa el ángulo horario medio de esta sección (~{{ha}}h), avanzado a ritmo sidéreo sobre los frames incluidos.", allTip "Alineación polar de todo el registro mediante un ajuste por mínimos cuadrados sobre {{count}} secciones a distintos ángulos horarios."

`de`: modeSection "Abschnitt", modeAll "Alle Abschnitte", confidence "Konfidenz", confHigh "Hoch", confMedium "Mittel", confLow "Niedrig", confInsufficient "—", confTipHigh "Hohe Konfidenz: die Abschnitte überspannen {{spread}}h Stundenwinkel mit geringem Residuum; Höhe und Azimut sind gut getrennt.", confTipMedium "Mittlere Konfidenz: geringe Stundenwinkel-Spanne ({{spread}}h) oder etwas Residuum; die Alt/Az-Trennung ist brauchbar.", confTipLow "Niedrige Konfidenz: schmale Stundenwinkel-Spanne oder großes Residuum — Alt/Az schlecht getrennt (auch eine Neujustage mitten in der Sitzung verursacht das).", confTipInsufficient "Nicht genug Abschnitte bei verschiedenen Stundenwinkeln, um Alt und Az im Log zu trennen.", effectiveHaTip "Die Alt/Az-Aufteilung nutzt den mittleren Stundenwinkel dieses Abschnitts (~{{ha}}h), siderisch über die einbezogenen Frames fortgeführt.", allTip "Polausrichtung des gesamten Logs aus einer Ausgleichsrechnung über {{count}} Abschnitte bei verschiedenen Stundenwinkeln."

`fr`: modeSection "Section", modeAll "Toutes les sections", confidence "Confiance", confHigh "Élevée", confMedium "Moyenne", confLow "Faible", confInsufficient "—", confTipHigh "Confiance élevée : les sections couvrent {{spread}}h d'angle horaire avec un faible résidu ; Alt et Az sont bien séparés.", confTipMedium "Confiance moyenne : faible plage d'angle horaire ({{spread}}h) ou un peu de résidu ; la séparation Alt/Az est correcte.", confTipLow "Confiance faible : plage d'angle horaire étroite ou résidu important — Alt/Az mal séparés (un réalignement en cours de session le causerait aussi).", confTipInsufficient "Pas assez de sections à différents angles horaires pour séparer Alt et Az sur le journal.", effectiveHaTip "La répartition Alt/Az utilise l'angle horaire moyen de cette section (~{{ha}}h), avancé au taux sidéral sur les frames inclus.", allTip "Alignement polaire de tout le journal par moindres carrés sur {{count}} sections à différents angles horaires."

`it`: modeSection "Sezione", modeAll "Tutte le sezioni", confidence "Affidabilità", confHigh "Alta", confMedium "Media", confLow "Bassa", confInsufficient "—", confTipHigh "Affidabilità alta: le sezioni coprono {{spread}}h di angolo orario con basso residuo; Alt e Az sono ben separati.", confTipMedium "Affidabilità media: scarso intervallo di angolo orario ({{spread}}h) o un po' di residuo; la separazione Alt/Az è discreta.", confTipLow "Affidabilità bassa: intervallo di angolo orario stretto o residuo elevato — Alt/Az poco separati (anche un riallineamento a metà sessione lo causerebbe).", confTipInsufficient "Sezioni insufficienti a diversi angoli orari per separare Alt e Az nel log.", effectiveHaTip "La suddivisione Alt/Az usa l'angolo orario medio di questa sezione (~{{ha}}h), avanzato al ritmo siderale sui frame inclusi.", allTip "Allineamento polare dell'intero log con un fit ai minimi quadrati su {{count}} sezioni a diversi angoli orari."

`zh`: modeSection "区段", modeAll "所有区段", confidence "可信度", confHigh "高", confMedium "中", confLow "低", confInsufficient "—", confTipHigh "高可信度:各区段跨越 {{spread}} 小时时角且残差很小,高度与方位分离良好。", confTipMedium "中可信度:时角跨度有限({{spread}} 小时)或存在一些残差;高度/方位分离尚可。", confTipLow "低可信度:时角跨度窄或残差大——高度/方位分离不佳(会话中途重新校准也会导致此情况)。", confTipInsufficient "不同时角的区段不足,无法在该日志中分离高度与方位。", effectiveHaTip "高度/方位拆分使用本区段的平均时角(约 {{ha}} 小时),按恒星速率在所含帧上推进。", allTip "由对 {{count}} 个不同时角区段的最小二乘拟合得到的整个日志极轴校准。"

- [ ] **Step 3: Validate JSON + tsc**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && for f in en es de fr it zh; do node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/$f/stats.json','utf8'));console.log('$f ok')"; done && node node_modules/typescript/bin/tsc --noEmit`
Expected: 6× ok; tsc clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/i18n/locales/*/stats.json
git commit -m "i18n(stats): confidence / mode / effective-HA tooltip strings"
```

---

### Task 6: `PolarAlignmentPlot` — narrow tooltips + mode-agnostic rendering

**Files:**
- Modify: `web/src/components/PolarAlignmentPlot.tsx`

**Interfaces:**
- Consumes: `wrapTip` (Task 1).
- Produces: the plot takes an optional `titleText?: string` (overrides the default `pa.tooltip`); all `title`/`<title>` text wrapped via `wrapTip`. The existing magnitude/dot/badge logic is unchanged; badges still show only when `hasHa && !trust` (StatsGrid passes `altTrust=azTrust=true` for All-Sections, suppressing them).

- [ ] **Step 1: Wrap tooltips + accept a title override**

In `web/src/components/PolarAlignmentPlot.tsx`:
- Add `import { wrapTip } from '../i18n/format';`.
- Add `titleText?: string` to the `Props` interface and destructure it (default to `t('pa.tooltip')`).
- Replace the root `aria-label={t('pa.tooltip')}` and `<title>{t('pa.tooltip')}</title>` with `wrapTip(titleText ?? t('pa.tooltip'))`.
- Wrap the badge `<title>` texts: `<title>{wrapTip(t('pa.azLowConf'))}</title>` and `<title>{wrapTip(t('pa.altLowConf'))}</title>`.

- [ ] **Step 2: tsc**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/PolarAlignmentPlot.tsx
git commit -m "feat(ui): narrow PolarAlignmentPlot tooltips + optional title override"
```

---

### Task 7: `StatsGrid` — single toggling PA area (Section ⟷ All Sections)

**Files:**
- Modify: `web/src/components/StatsGrid.tsx`

**Interfaces:**
- Consumes: `computeGlobalPolarAlignment` (Task 3), `wrapTip` (Task 1), `SessionStats.effectiveHaHours` (Task 4), the new i18n keys (Task 5), `PolarAlignmentPlot` `titleText` (Task 6).

- [ ] **Step 1: Imports + global compute + toggle state**

In `web/src/components/StatsGrid.tsx`:
- Add imports: `import { useState, useMemo } from 'react';` (merge with existing react import); `import { computeGlobalPolarAlignment } from '../parser/globalPolarAlignment';`; `import { wrapTip } from '../i18n/format';`.
- Inside the component, after the existing `stats` memo, add:

```ts
  const global = useMemo(
    () => (log ? computeGlobalPolarAlignment(log, exclusions) : null),
    [log, exclusions],
  );
  const [paView, setPaView] = useState<'section' | 'all'>('section');
```

- [ ] **Step 2: Replace the Polar Alignment block with the toggling version**

Replace the existing PA subtitled block (the `<div className="mt-1 border-t border-slate-700/60 pt-1"> … </div>` containing the `rows.polarAlign` label, the total badge, the Alt/Az line, the Drift line) **and** the sibling `<PolarAlignmentPlot … />` with this. (Keep the outer `<div className="flex flex-wrap items-start gap-4 …">` wrapper and the Total/RA/Dec `<Row>`s.)

Define these just before the `return`:

```ts
  const isAll = paView === 'all';
  const g = global;
  const confKey = g ? `pa.conf${g.confidence[0].toUpperCase()}${g.confidence.slice(1)}` : 'pa.confInsufficient';
  const confColor = g?.confidence === 'high' ? 'text-emerald-400'
    : g?.confidence === 'medium' ? 'text-amber-300'
    : g?.confidence === 'low' ? 'text-rose-400' : 'text-slate-400';
  // values shown in the active mode
  const total = isAll ? (g && g.confidence !== 'insufficient' ? g.totalArcMin : null) : s.paeArcMin;
  const altV = isAll ? (g && g.confidence !== 'insufficient' ? g.altArcMin : null) : s.altArcMin;
  const azV = isAll ? (g && g.confidence !== 'insufficient' ? g.azArcMin : null) : s.azArcMin;
  const bandVal = total ?? 0;
  const determinable = isAll ? !!(g && g.confidence !== 'insufficient') : s.paeDeterminable;
  const haTip = s.effectiveHaHours !== null ? wrapTip(t('pa.effectiveHaTip', { ha: fmt(s.effectiveHaHours, 1) })) : undefined;
  const toggle = () => setPaView((v) => (v === 'section' ? 'all' : 'section'));
```

Then the JSX block (replacing the old PA block + plot):

```tsx
        {/* Polar Alignment — one toggling area (Section ⟷ All Sections) */}
        <div className="mt-1 border-t border-slate-700/60 pt-1">
          <button
            type="button"
            onClick={toggle}
            className="mb-0.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-400 hover:opacity-80"
            title={wrapTip(isAll ? t('pa.allTip', { count: g?.sectionCount ?? 0 }) : t('pa.tooltip'))}
          >
            {t('rows.polarAlign')}
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-100">
              {isAll ? t('pa.modeAll') : t('pa.modeSection')}
            </span>
            <span className="text-[10px] text-slate-500">⟳</span>
          </button>

          {/* Line 1: total */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            {determinable
              ? <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${BAND_CLASSES[polarAlignmentBand(bandVal)]}`}>{`${fmt(bandVal, 2)}′`}</span>
              : <span className="font-mono text-xs text-slate-400">—</span>}
          </div>

          {/* Line 2: Alt / Az (section shows "!" markers; All Sections does not) */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">Alt</span>
              <span className="font-mono text-slate-100">{altV === null ? '—' : `${fmt(altV, 2)}′`}</span>
              {!isAll && hasHa && !s.altTrust && <span className="cursor-help font-bold text-amber-400" title={wrapTip(t('pa.altLowConf'))}>!</span>}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">Az</span>
              <span className="font-mono text-slate-100">{azV === null ? '—' : `${fmt(azV, 2)}′`}</span>
              {!isAll && hasHa && !s.azTrust && <span className="cursor-help font-bold text-amber-400" title={wrapTip(t('pa.azLowConf'))}>!</span>}
            </span>
          </div>

          {/* Line 3: Section → drift; All Sections → confidence */}
          {isAll ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm" title={wrapTip(t(`pa.confTip${(g?.confidence ?? 'insufficient')[0].toUpperCase()}${(g?.confidence ?? 'insufficient').slice(1)}`, { spread: fmt(g?.haSpreadHours ?? 0, 1) }))}>
              <span className="flex items-baseline gap-2">
                <span className="text-xs text-slate-400">{t('pa.confidence')}</span>
                <span className={`font-mono font-semibold ${confColor}`}>{t(confKey)}</span>
              </span>
              <span className="text-xs text-slate-500">· {g?.sectionCount ?? 0} sections</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <Cell k="RA Drift" v={drift(s.driftRa)} />
              <Cell k="Dec Drift" v={drift(s.driftDec)} />
            </div>
          )}
        </div>

        {/* The bullseye toggles with the area */}
        <button type="button" onClick={toggle} className="shrink-0" title={wrapTip(isAll ? t('pa.allTip', { count: g?.sectionCount ?? 0 }) : t('pa.tooltip'))}>
          <PolarAlignmentPlot
            paeTotal={bandVal}
            altArcMin={altV}
            azArcMin={azV}
            altTrust={isAll ? true : s.altTrust}
            azTrust={isAll ? true : s.azTrust}
            hasHa={isAll ? false : hasHa}
            determinable={determinable}
            titleText={isAll ? t('pa.allTip', { count: g?.sectionCount ?? 0 }) : (haTip ? t('pa.effectiveHaTip', { ha: fmt(s.effectiveHaHours ?? 0, 1) }) : t('pa.tooltip'))}
          />
        </button>
```

Note: the plot sits as a sibling of the stats column inside the existing outer `flex` wrapper, exactly where `<PolarAlignmentPlot/>` was. The `<button>` wrapper makes the bullseye clickable to toggle; `PolarAlignmentPlot` already wraps tooltip text (Task 6).

- [ ] **Step 3: tsc + full suite**

Run: `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run`
Expected: tsc clean; full suite green.

- [ ] **Step 4: Manual check**

Dev server + sample log: the PA area shows **Section** by default (seg 10 Az ≈ 0.39′ now, with "!"); click it → **All Sections** with a total, Alt/Az (no "!"), and **Confidence** (likely High/Medium over the ~5h span) · N sections; click again → back. Tooltips are narrow.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/StatsGrid.tsx
git commit -m "feat(ui): toggling Polar Alignment area (Section / All Sections) with confidence"
```

---

### Task 8: Developer explainer doc

**Files:**
- Create: `docs/polar-alignment-explained.md`

A standalone doc (for sharing with another developer) describing the as-built behavior. No code; written after Tasks 1–7 land so it matches reality.

- [ ] **Step 1: Write the doc**

Create `docs/polar-alignment-explained.md` covering:
1. **Per-section PA** — included-frame set (star-found, settling-excluded, mask); back-out-corrections drift (algebraic RA endpoint; cumulative Dec slope with skip-gaps); `PAE = 3.8197·|Dec drift ″/min|/cos δ`; the **effective (mean) hour angle** and the min-norm Alt/Az projection (`az=PAE·|cosH|`, `alt=PAE·|sinH|`) with the trust "!" flags.
2. **Whole-log ("All Sections") PA** — the linear model `e_i = A·cosH_i + E·sinH_i`, the 2×2 least-squares solve, pier-side normalization, the qualifying-section rule, and the confidence rating (HA spread + residual).
3. **Comparison to the C++ phdlogview** — reproduces the desktop's `RA Drift`/`Dec Drift`/`Polar Alignment Error` (validated on sample segs 8/10/15: RA exact, Dec ±0.01″, PAE within 0.1′); the desktop has **no** Alt/Az split and **no** whole-log solve; settling policy matches the desktop default (API settling only), with a stricter "+ dithers" option.
4. **Accuracy assessment** — *Section:* total PAE is accurate (matches the desktop), but the Alt/Az split is a single-section min-norm estimate — only the axis the hour angle favors is reliable (hence "!"); the effective HA fixes the start-vs-mean error. *Whole-log:* resolves the Alt/Az ambiguity by combining hour angles; accuracy scales with HA spread and fit residual, surfaced as the confidence rating; assumes one alignment across the log (a re-align shows as a large residual / Low confidence).

- [ ] **Step 2: Commit**

```bash
git add docs/polar-alignment-explained.md
git commit -m "docs: developer explainer for polar-alignment calculation + accuracy"
```

---

### Task 9: Full verification + PR

- [ ] **Step 1:** `cd /g/HomeLab-Repos/PHDLogViewer/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run` — tsc clean, suite green.
- [ ] **Step 2:** Manual: sample log — Section seg 10 Az ≈ 0.39′; toggle to All Sections shows a solved total + Confidence; tooltips narrow.
- [ ] **Step 3:** Push + PR:
```bash
git push -u origin feat/pa-accuracy
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "feat: PA accuracy — effective HA + whole-log solve + toggling UI" --body "Implements docs/superpowers/specs/2026-06-17-pa-accuracy-design.md. Effective-HA Alt/Az split, whole-log least-squares solve with confidence, one toggling Section/All-Sections area, narrow tooltips, and a developer explainer doc."
```
- [ ] **Step 4:** Auto-merge per policy once tsc+vitest are confirmed clean: `gh pr merge <num> --squash --delete-branch && git checkout main && git pull --ff-only`.

---

## Self-Review

**Spec coverage:** §2 effective HA → Task 2 (+ Task 4 exposes it). §3 global solve (model, pier-side, qualification, confidence) → Task 3. §4 toggling UI → Task 7 (plot Task 6). §5 confidence wording → Task 5 + Task 7. §6 narrow tooltips → Task 1 (helper) + Tasks 6/7 (applied). §7 edge cases: null HA (Task 2 null path; Task 3 skips), single section / insufficient (Task 3 → confidence —, Task 7 → "—"/no dot), declination extreme (skipped), memoization (Task 7 useMemo). §8 i18n → Task 5. §9 testing → unit tests Tasks 1–4 + manual. Developer doc (user request) → Task 8.

**Placeholder scan:** none — every step has concrete code/commands. The Task 5 translations are spelled out per locale.

**Type consistency:** `effectiveHaHours`/`includedCount` (Task 2) consumed by Task 3 (qualification) and Task 4 (SessionStats) and Task 7 (HA tooltip). `GlobalPolarAlignment`/`computeGlobalPolarAlignment` (Task 3) consumed by Task 7. `wrapTip` (Task 1) consumed by Tasks 6/7. `titleText` prop (Task 6) passed by Task 7. i18n keys (Task 5) consumed by Task 7. `polarAlignmentBand`/`BAND_CLASSES` already imported in StatsGrid.
