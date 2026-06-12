# Aspect Ratio badge metric — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the StatsGrid Total-row badge from Guiding Eccentricity to Aspect Ratio (`Max/Min` of RA & Dec RMS), keeping the eccentricity algorithm dormant behind a single source-code switch.

**Architecture:** Consolidate both metrics into one toggleable presentation module (`guidingMetric.ts`, renamed from `eccBand.ts`), each exposing `compute`/`band`/`labelKey`/`tooltipKey`. Remove the now-unused `ecc` field from the parser's `SessionStats`. The badge renders from the active `guidingMetric`, showing a neutral "—" when the metric is N/A.

**Tech Stack:** TypeScript, React, react-i18next, Tailwind, vitest. Commands run from `web/`.

**Spec:** `docs/superpowers/specs/2026-06-12-aspect-ratio-metric-design.md`

---

## File Structure

- `web/src/components/guidingMetric.ts` — NEW (replaces `eccBand.ts`): `Band`, `BAND_CLASSES`, `GuidingMetric` interface, `aspectRatioMetric`, `eccentricityMetric`, and the active `guidingMetric` switch.
- `web/src/components/eccBand.ts` — DELETE.
- `web/src/components/__tests__/guidingMetric.test.ts` — NEW (replaces `eccBand.test.ts`).
- `web/src/components/__tests__/eccBand.test.ts` — DELETE.
- `web/src/parser/stats.ts` — remove `ecc` from `SessionStats` + computation.
- `web/src/parser/__tests__/stats.test.ts` — remove the two `ecc` tests.
- `web/src/components/StatsGrid.tsx` — render the badge from `guidingMetric`.
- `web/src/i18n/locales/{en,es,de,fr,it,zh}/stats.json` — add `guide.aspectRatio` + `aspectRatioTooltip`.

---

## Task 1: guidingMetric module (both metrics + switch)

**Files:**
- Create: `web/src/components/guidingMetric.ts`
- Delete: `web/src/components/eccBand.ts`
- Create: `web/src/components/__tests__/guidingMetric.test.ts`
- Delete: `web/src/components/__tests__/eccBand.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/guidingMetric.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aspectRatioMetric, eccentricityMetric, guidingMetric } from '../guidingMetric';

describe('aspectRatioMetric.compute', () => {
  it('Max/Min of the two RMS values', () => {
    expect(aspectRatioMetric.compute(3, 5)).toBeCloseTo(5 / 3); // 1.6667
    expect(aspectRatioMetric.compute(5, 3)).toBeCloseTo(5 / 3); // order-independent
    expect(aspectRatioMetric.compute(5, 5)).toBe(1);
  });
  it('returns null when an axis RMS is 0 (no data / division by zero)', () => {
    expect(aspectRatioMetric.compute(0, 0)).toBeNull();
    expect(aspectRatioMetric.compute(0, 4)).toBeNull();
  });
});

describe('aspectRatioMetric.band', () => {
  it('green at or below 1.20', () => {
    expect(aspectRatioMetric.band(1)).toBe('green');
    expect(aspectRatioMetric.band(1.2)).toBe('green');
  });
  it('yellow from 1.21 to 1.60', () => {
    expect(aspectRatioMetric.band(1.21)).toBe('yellow');
    expect(aspectRatioMetric.band(1.6)).toBe('yellow');
  });
  it('red above 1.60', () => {
    expect(aspectRatioMetric.band(1.61)).toBe('red');
    expect(aspectRatioMetric.band(3)).toBe('red');
  });
  it('thresholds use the value rounded to 2 decimals', () => {
    expect(aspectRatioMetric.band(1.604)).toBe('yellow'); // -> 1.60
    expect(aspectRatioMetric.band(1.605)).toBe('red');     // -> 1.61
  });
});

describe('eccentricityMetric (dormant, kept)', () => {
  it('compute: sqrt(1 - lo^2/hi^2), order-independent, null on no motion', () => {
    expect(eccentricityMetric.compute(3, 5)).toBeCloseTo(0.8);
    expect(eccentricityMetric.compute(5, 3)).toBeCloseTo(0.8);
    expect(eccentricityMetric.compute(4, 4)).toBeCloseTo(0);
    expect(eccentricityMetric.compute(0, 0)).toBeNull();
  });
  it('band thresholds', () => {
    expect(eccentricityMetric.band(0.5)).toBe('green');
    expect(eccentricityMetric.band(0.65)).toBe('yellow');
    expect(eccentricityMetric.band(0.66)).toBe('red');
  });
});

describe('active metric', () => {
  it('defaults to Aspect Ratio', () => {
    expect(guidingMetric).toBe(aspectRatioMetric);
    expect(guidingMetric.labelKey).toBe('guide.aspectRatio');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/guidingMetric.test.ts`
Expected: FAIL — cannot find module `../guidingMetric`.

- [ ] **Step 3: Create the module**

Create `web/src/components/guidingMetric.ts`:

```ts
// Single source of truth for the StatsGrid Total-row metric badge. Two metrics
// are defined; `guidingMetric` selects the active one. Both are pure ratios of
// the per-axis RMS (rmsRa, rmsDec), so they are scale-independent and
// order-independent. `compute` returns null when there is no motion to measure
// (an empty / fully-excluded selection), which the badge renders as "—".

export type Band = 'green' | 'yellow' | 'red';

// Tailwind background + readable text per band (white on green/red, dark on the
// light amber). Literal strings so Tailwind's content scan keeps them.
export const BAND_CLASSES: Record<Band, string> = {
  green: 'bg-emerald-600 text-white',
  yellow: 'bg-amber-400 text-slate-900',
  red: 'bg-rose-600 text-white',
};

export interface GuidingMetric {
  labelKey: string;    // i18n key for the badge label
  tooltipKey: string;  // i18n key for the badge tooltip
  compute(rmsRa: number, rmsDec: number): number | null;  // null = N/A
  band(value: number): Band;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Aspect Ratio = Max/Min of the two RMS values. 1.00 = round, higher = elongated.
export const aspectRatioMetric: GuidingMetric = {
  labelKey: 'guide.aspectRatio',
  tooltipKey: 'aspectRatioTooltip',
  compute(rmsRa, rmsDec) {
    const lo = Math.min(rmsRa, rmsDec);
    const hi = Math.max(rmsRa, rmsDec);
    return lo > 0 ? hi / lo : null;
  },
  band(value) {
    const r = round2(value);
    if (r <= 1.2) return 'green';
    if (r <= 1.6) return 'yellow';
    return 'red';
  },
};

// Eccentricity = sqrt(1 - min^2/max^2). 0 = round, ->1 = elongated. Dormant;
// flip `guidingMetric` below to re-enable.
export const eccentricityMetric: GuidingMetric = {
  labelKey: 'guide.eccentricity',
  tooltipKey: 'eccentricityTooltip',
  compute(rmsRa, rmsDec) {
    const lo = Math.min(rmsRa, rmsDec);
    const hi = Math.max(rmsRa, rmsDec);
    return hi > 0 ? Math.sqrt(1 - (lo * lo) / (hi * hi)) : null;
  },
  band(value) {
    const r = round2(value);
    if (r <= 0.5) return 'green';
    if (r <= 0.65) return 'yellow';
    return 'red';
  },
};

// Source-code switch: change to `eccentricityMetric` to restore the old metric.
export const guidingMetric: GuidingMetric = aspectRatioMetric;
```

- [ ] **Step 4: Delete the old module + test**

```bash
git rm web/src/components/eccBand.ts web/src/components/__tests__/eccBand.test.ts
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/__tests__/guidingMetric.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/guidingMetric.ts web/src/components/__tests__/guidingMetric.test.ts
git commit -m "feat: guidingMetric module with Aspect Ratio (active) + Eccentricity (dormant)"
```

---

## Task 2: Remove `ecc` from the parser stats

**Files:**
- Modify: `web/src/parser/stats.ts`
- Modify: `web/src/parser/__tests__/stats.test.ts`

- [ ] **Step 1: Remove the two `ecc` tests**

In `web/src/parser/__tests__/stats.test.ts`, delete these two `it(...)` blocks entirely (they moved to `guidingMetric.test.ts` in Task 1):

```ts
  it('eccentricity: symmetric sqrt(1 - lo^2/hi^2), order-independent', () => {
    // RA values [3,-3] -> rmsRa 3; Dec values [5,-5] -> rmsDec 5.
    // ecc = sqrt(1 - 9/25) = sqrt(16/25) = 0.8.
    const s = newGuideSession('x');
    s.entries = [mkE(1, 1, 3, 5), mkE(2, 2, -3, -5)];
    expect(calcStats(s).ecc).toBeCloseTo(0.8);
    // Swap the axes (rmsRa 5, rmsDec 3) -> same eccentricity.
    const s2 = newGuideSession('x');
    s2.entries = [mkE(1, 1, 5, 3), mkE(2, 2, -5, -3)];
    expect(calcStats(s2).ecc).toBeCloseTo(0.8);
  });

  it('eccentricity: equal axes -> 0, no motion -> 0 (guard)', () => {
    const eq = newGuideSession('x');
    eq.entries = [mkE(1, 1, 4, 4), mkE(2, 2, -4, -4)];
    expect(calcStats(eq).ecc).toBeCloseTo(0);
    const zero = newGuideSession('x');
    zero.entries = [mkE(1, 1, 0, 0), mkE(2, 2, 0, 0)];
    expect(calcStats(zero).ecc).toBe(0);
  });
```

- [ ] **Step 2: Remove the `ecc` interface field**

In `web/src/parser/stats.ts`, delete these lines from the `SessionStats` interface:

```ts
  /** Scatter eccentricity in [0,1]: sqrt(1 - min(rmsRa,rmsDec)^2 / max^2).
   *  0 = round/balanced, ->1 = elongated. Scale-independent (a ratio). */
  ecc: number;
```

- [ ] **Step 3: Remove the computation + return field**

In `web/src/parser/stats.ts`, delete the computation block:

```ts
  // Scatter eccentricity: smaller axis under the larger (semi-major), so it is
  // always real and in [0,1] regardless of which axis is worse. Equal axes -> 0
  // (round), divergent -> 1 (elongated). Guard the degenerate no-motion case.
  const eccLo = Math.min(rmsRa, rmsDec);
  const eccHi = Math.max(rmsRa, rmsDec);
  const ecc = eccHi > 0 ? Math.sqrt(1 - (eccLo * eccLo) / (eccHi * eccHi)) : 0;
```

And remove the `ecc,` line from the returned object so it reads:

```ts
  return {
    rmsRa, rmsDec, rmsTotal,
    peakRa, peakDec,
```

- [ ] **Step 4: Run stats tests to verify they pass**

Run: `cd web && npx vitest run src/parser/__tests__/stats.test.ts`
Expected: PASS (the remaining stats tests; no `ecc` references).

- [ ] **Step 5: Commit**

```bash
git add web/src/parser/stats.ts web/src/parser/__tests__/stats.test.ts
git commit -m "refactor: drop the ecc field from SessionStats (metric now lives in guidingMetric)"
```

---

## Task 3: Render the badge from the active metric

**Files:**
- Modify: `web/src/components/StatsGrid.tsx`

- [ ] **Step 1: Update the import**

In `web/src/components/StatsGrid.tsx`, replace the eccBand import:

```ts
import { eccBand, ECC_BAND_CLASSES } from './eccBand';
```

with:

```ts
import { guidingMetric, BAND_CLASSES } from './guidingMetric';
```

- [ ] **Step 2: Replace the badge**

In `web/src/components/StatsGrid.tsx`, replace the existing `eccBadge` block (the `// Eccentricity badge:` comment and the `const eccBadge = ( ... );` JSX) with:

```tsx
  // Guiding metric badge (Aspect Ratio by default; see guidingMetric switch).
  // Color-coded by band with readable contrast text; neutral "—" when N/A.
  const metric = guidingMetric;
  const metricValue = metric.compute(s.rmsRa, s.rmsDec);
  const metricText = metricValue === null ? '—' : fmt(metricValue, 2);
  const metricCls = metricValue === null ? 'bg-slate-700 text-slate-400' : BAND_CLASSES[metric.band(metricValue)];
  const metricBadge = (
    <button
      className={`flex items-baseline gap-1 rounded px-1.5 py-0.5 ${metricCls} hover:opacity-90`}
      onClick={metricValue === null ? undefined : () => copy(metricText)}
      title={t(metric.tooltipKey, { value: metricText, ra: v(s.rmsRa), dec: v(s.rmsDec) })}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-90">{t(metric.labelKey)}</span>
      <span className="font-mono">{metricText}</span>
    </button>
  );
```

- [ ] **Step 3: Update the Total row to use the new badge name**

In `web/src/components/StatsGrid.tsx`, change:

```tsx
      <Row label={t('rows.total')} items={common} trailing={eccBadge} />
```

to:

```tsx
      <Row label={t('rows.total')} items={common} trailing={metricBadge} />
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/StatsGrid.tsx
git commit -m "feat: StatsGrid badge renders the active guiding metric (Aspect Ratio)"
```

---

## Task 4: i18n for Aspect Ratio (all 6 locales)

**Files:**
- Modify: `web/src/i18n/locales/{en,es,de,fr,it,zh}/stats.json`

- [ ] **Step 1: Add the label key**

In each `…/stats.json`, add `aspectRatio` to the `"guide"` object right after the existing `"eccentricity"` line. Values:

| locale | value |
|---|---|
| en | Aspect Ratio |
| es | Relación de aspecto |
| de | Seitenverhältnis |
| fr | Rapport d'aspect |
| it | Rapporto d'aspetto |
| zh | 纵横比 |

Example (en) — the `"guide"` block becomes:

```json
    "eccentricity": "Guiding Eccentricity",
    "aspectRatio": "Aspect Ratio",
    "secondsSuffix": "s",
```

- [ ] **Step 2: Add the tooltip key**

In each `…/stats.json`, add `aspectRatioTooltip` as a top-level key immediately after the existing `eccentricityTooltip` line. Per-locale strings (same `{{value}}`/`{{ra}}`/`{{dec}}` interpolation):

- en: `Aspect ratio {{value}} — Max/Min of the RA & Dec RMS (1.00 = round, higher = elongated). RA {{ra}} / Dec {{dec}}`
- es: `Relación de aspecto {{value}} — Máx/Mín del RMS de RA y Dec (1.00 = redonda, mayor = alargada). RA {{ra}} / Dec {{dec}}`
- de: `Seitenverhältnis {{value}} — Max/Min des RA- und Dec-RMS (1.00 = rund, höher = länglich). RA {{ra}} / Dec {{dec}}`
- fr: `Rapport d'aspect {{value}} — Max/Min des RMS RA et Dec (1.00 = ronde, plus élevé = allongée). RA {{ra}} / Dec {{dec}}`
- it: `Rapporto d'aspetto {{value}} — Max/Min dell'RMS di RA e Dec (1.00 = rotonda, maggiore = allungata). RA {{ra}} / Dec {{dec}}`
- zh: `纵横比 {{value}} — RA 与 Dec RMS 的最大/最小值（1.00 = 圆形，越大越拉长）。RA {{ra}} / Dec {{dec}}`

Example (en) — after the existing `eccentricityTooltip`:

```json
  "eccentricityTooltip": "Eccentricity {{value}} — elongation of the RA/Dec scatter (0 = round, 1 = a line). RA {{ra}} / Dec {{dec}}",
  "aspectRatioTooltip": "Aspect ratio {{value}} — Max/Min of the RA & Dec RMS (1.00 = round, higher = elongated). RA {{ra}} / Dec {{dec}}",
```

- [ ] **Step 3: Validate the JSON**

Run: `cd web && node -e "for (const l of ['en','es','de','fr','it','zh']) { JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'/stats.json','utf8')); console.log(l,'ok'); }"`
Expected: `en ok` … `zh ok` (all parse).

- [ ] **Step 4: Commit**

```bash
git add web/src/i18n/locales
git commit -m "i18n: Aspect Ratio label + tooltip across 6 locales"
```

---

## Task 5: Full verification + PR

- [ ] **Step 1: Typecheck + full suite**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; all tests pass (273 prior − 2 removed ecc + new guidingMetric cases).

- [ ] **Step 2: Browser verification**

Dev server on `http://localhost:5173/phd2-log-viewer-web/`. Load a guiding log (e.g. `QuarkPHD2_GuideLog_2026-06-05_223909.txt` from `sample data/`), select a guiding section, and confirm:
- The Total-row badge now reads **"ASPECT RATIO n.nn"** (e.g. RA 0.750 / Dec 0.547 → 1.37, yellow).
- The color band matches the value (≤1.20 green, 1.21–1.60 yellow, >1.60 red).
- Switch to a light theme and confirm the badge text stays readable.

- [ ] **Step 3: Push + open the PR**

```bash
git push -u origin feat/aspect-ratio-metric
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "feat: Aspect Ratio metric badge (eccentricity kept as code toggle)" --body "<summary + test evidence>"
```

- [ ] **Step 4: Merge per the auto-merge policy (coding PR, tests green)**

```bash
gh api -X PUT repos/bvalente22/phd2-log-viewer-web/pulls/<N>/merge -f merge_method=squash
git checkout main && git pull --ff-only
```

---

## Self-Review

**Spec coverage:**
- Aspect Ratio compute (Max/Min, null guard) → Task 1 (`aspectRatioMetric.compute`). ✓
- Aspect Ratio bands (≤1.20/≤1.60/red) → Task 1 (`aspectRatioMetric.band`). ✓
- Eccentricity kept, dormant, behind switch → Task 1 (`eccentricityMetric`, `guidingMetric`). ✓
- 2-decimal display + N/A "—" → Task 3 (`fmt(...,2)`, neutral badge). ✓
- Remove `ecc` from parser stats → Task 2. ✓
- Badge renders active metric / label / tooltip → Task 3. ✓
- i18n label + tooltip, 6 locales, keep eccentricity keys → Task 4. ✓
- Tests (metric compute/band; eccentricity retained) → Task 1; stats tests pruned in Task 2. ✓

**Placeholder scan:** All code steps are complete. `<summary>`/`<N>` in Task 5 are runtime values, not code placeholders.

**Type consistency:** `guidingMetric`/`aspectRatioMetric`/`eccentricityMetric`/`BAND_CLASSES`/`GuidingMetric` defined in Task 1, imported in Task 3. `compute(): number | null` handled by the `metricValue === null` branch in Task 3. `labelKey`/`tooltipKey` strings (`guide.aspectRatio`, `aspectRatioTooltip`) match the i18n keys added in Task 4. `ecc` removed in Task 2 is no longer referenced after Task 3’s badge rewrite. Consistent.
