# Guiding dashboard tiles + StatsGrid eccentricity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four additive guiding-section UI elements — an Exposure tile, PPEC dual-gain (control + prediction) on the RA algorithm tile, an "AO Unit: Present" tile, and a color-coded eccentricity badge in the StatsGrid Total row.

**Architecture:** Pure-logic changes land in the parser layer (`stats.ts` eccentricity, `guideHeader.ts` exposure/AO/PPEC) with vitest coverage; presentation lands in two components (`GuidingDashboard.tsx`, `StatsGrid.tsx`) plus a tiny pure `eccBand.ts` color-classifier. New caption strings go into all six i18n locales.

**Tech Stack:** TypeScript, React, Zustand, react-i18next, Tailwind, vitest. Commands run from `web/`.

**Spec:** `docs/superpowers/specs/2026-06-12-dashboard-exposure-ppec-ao-eccentricity-design.md`

---

## File Structure

- `web/src/parser/stats.ts` — add `ecc` to `SessionStats`, compute in `calcStats`.
- `web/src/parser/__tests__/stats.test.ts` — eccentricity cases.
- `web/src/components/eccBand.ts` — NEW: pure `eccBand(e)` + `ECC_BAND_CLASSES`.
- `web/src/components/__tests__/eccBand.test.ts` — NEW: threshold cases.
- `web/src/parser/guideHeader.ts` — add `exposure`, `aoPresent`; PPEC enrichment of `ra.param`.
- `web/src/parser/__tests__/guideHeader.test.ts` — exposure/AO/PPEC cases + update the all-null shape test.
- `web/src/components/GuidingDashboard.tsx` — Exposure + AO tiles (PPEC flows automatically via `ra.param`).
- `web/src/components/StatsGrid.tsx` — eccentricity badge in the Total row.
- `web/src/i18n/locales/{en,es,de,fr,it,zh}/sections.json` — `dashboard.exposure`, `dashboard.aoUnit`, `dashboard.aoPresent`.
- `web/src/i18n/locales/{en,es,de,fr,it,zh}/stats.json` — `guide.eccentricity`.

---

## Task 1: Eccentricity in calcStats

**Files:**
- Modify: `web/src/parser/stats.ts` (add `ecc` to `SessionStats`, compute in `calcStats`)
- Test: `web/src/parser/__tests__/stats.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('calcStats', …)` block in `web/src/parser/__tests__/stats.test.ts`:

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

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/parser/__tests__/stats.test.ts`
Expected: FAIL — `ecc` is `undefined` (property missing on `SessionStats`).

- [ ] **Step 3: Add `ecc` to the interface**

In `web/src/parser/stats.ts`, add to the `SessionStats` interface, right after `rmsTotal: number;`:

```ts
  /** Scatter eccentricity in [0,1]: sqrt(1 - min(rmsRa,rmsDec)^2 / max^2).
   *  0 = round/balanced, ->1 = elongated. Scale-independent (a ratio). */
  ecc: number;
```

- [ ] **Step 4: Compute it in `calcStats`**

In `web/src/parser/stats.ts`, immediately after the `const rmsTotal = …` line (around line 101), add:

```ts
  const eccLo = Math.min(rmsRa, rmsDec);
  const eccHi = Math.max(rmsRa, rmsDec);
  const ecc = eccHi > 0 ? Math.sqrt(1 - (eccLo * eccLo) / (eccHi * eccHi)) : 0;
```

Then add `ecc,` to the returned object literal, right after `rmsRa, rmsDec, rmsTotal,`:

```ts
  return {
    rmsRa, rmsDec, rmsTotal,
    ecc,
    peakRa, peakDec,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/parser/__tests__/stats.test.ts`
Expected: PASS (all, including the two new cases).

- [ ] **Step 6: Commit**

```bash
git add web/src/parser/stats.ts web/src/parser/__tests__/stats.test.ts
git commit -m "feat: compute scatter eccentricity in calcStats"
```

---

## Task 2: eccBand color classifier

**Files:**
- Create: `web/src/components/eccBand.ts`
- Test: `web/src/components/__tests__/eccBand.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/eccBand.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eccBand } from '../eccBand';

describe('eccBand', () => {
  it('green at or below 0.50', () => {
    expect(eccBand(0)).toBe('green');
    expect(eccBand(0.50)).toBe('green');
    expect(eccBand(0.499)).toBe('green'); // rounds to 0.50
  });
  it('yellow from 0.51 to 0.65', () => {
    expect(eccBand(0.51)).toBe('yellow');
    expect(eccBand(0.65)).toBe('yellow');
  });
  it('red at 0.66 and above', () => {
    expect(eccBand(0.66)).toBe('red');
    expect(eccBand(0.80)).toBe('red');
    expect(eccBand(1)).toBe('red');
  });
  it('thresholds use the value rounded to 2 decimals', () => {
    expect(eccBand(0.654)).toBe('yellow'); // -> 0.65
    expect(eccBand(0.655)).toBe('red');     // -> 0.66
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/eccBand.test.ts`
Expected: FAIL — cannot find module `../eccBand`.

- [ ] **Step 3: Create the implementation**

Create `web/src/components/eccBand.ts`:

```ts
// Pure presentation classifier for the StatsGrid eccentricity badge.
// Thresholds are evaluated on the value ROUNDED to 2 decimals — the same
// number the user sees — so a displayed 0.50 is green and 0.66 is red.

export type EccBand = 'green' | 'yellow' | 'red';

export function eccBand(e: number): EccBand {
  const r = Math.round(e * 100) / 100;
  if (r <= 0.5) return 'green';
  if (r <= 0.65) return 'yellow';
  return 'red';
}

// Tailwind background + readable text per band (white on green/red, dark on
// the light amber). Literal strings so Tailwind's content scan keeps them.
export const ECC_BAND_CLASSES: Record<EccBand, string> = {
  green: 'bg-emerald-600 text-white',
  yellow: 'bg-amber-400 text-slate-900',
  red: 'bg-rose-600 text-white',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/__tests__/eccBand.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/eccBand.ts web/src/components/__tests__/eccBand.test.ts
git commit -m "feat: eccBand color classifier for the eccentricity badge"
```

---

## Task 3: parseGuideHeader — exposure, AO, PPEC gains

**Files:**
- Modify: `web/src/parser/guideHeader.ts`
- Test: `web/src/parser/__tests__/guideHeader.test.ts`

- [ ] **Step 1: Write the failing tests**

In `web/src/parser/__tests__/guideHeader.test.ts`, add these cases inside the `describe('parseGuideHeader', …)` block:

```ts
  it('parses exposure (raw ms) and reports AO presence', () => {
    const info = parseGuideHeader([
      'Exposure = 2000 ms',
      'AO = SX AO-LF, ...',
    ]);
    expect(info.exposure).toBe('2000');
    expect(info.aoPresent).toBe(true);
  });

  it('exposure null + aoPresent false when those lines are absent', () => {
    const info = parseGuideHeader(['Pier side = West']);
    expect(info.exposure).toBeNull();
    expect(info.aoPresent).toBe(false);
  });

  it('PPEC: surfaces both control and prediction gains on the RA tile', () => {
    const a = parseGuideHeader([
      'X guide algorithm = Predictive PEC, Control gain = 0.800',
      'Prediction gain = 0.800',
    ]).ra;
    expect(a).toEqual({ name: 'Predictive PEC', param: 'ctrl 0.8 · pred 0.8', minMove: null });
  });

  it('PPEC with only a control gain shows just ctrl', () => {
    const a = parseGuideHeader([
      'X guide algorithm = Predictive PEC, Control gain = 0.600',
    ]).ra;
    expect(a).toEqual({ name: 'Predictive PEC', param: 'ctrl 0.6', minMove: null });
  });
```

Then UPDATE the existing all-null test (it currently feeds `Exposure = 2000 ms` and asserts the exact object shape). Replace its body so the expectation includes the new fields and no longer mixes exposure into the "all-null" input:

```ts
  it('returns all-null when header lacks the relevant lines', () => {
    const info = parseGuideHeader(['Equipment Profile = ASI MACH1']);
    expect(info).toEqual({
      pierSide: null, hourAngle: null, declination: null, altitude: null,
      azimuth: null, rotator: null, backlash: null, ra: null, dec: null,
      exposure: null, aoPresent: false,
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/parser/__tests__/guideHeader.test.ts`
Expected: FAIL — `info.exposure`/`info.aoPresent` undefined; PPEC param is `control gain 0.8` (generic), not `ctrl 0.8 · pred 0.8`.

- [ ] **Step 3: Extend the interface**

In `web/src/parser/guideHeader.ts`, add two fields to `GuideHeaderInfo`, after `dec: AlgoInfo | null;`:

```ts
  exposure: string | null;     // raw exposure in ms, e.g. "2000"
  aoPresent: boolean;          // an "AO = …" line exists in the header
```

- [ ] **Step 4: Add a PPEC helper**

In `web/src/parser/guideHeader.ts`, add this function just above `export const parseGuideHeader`:

```ts
// Predictive PEC logs the control gain on the "X guide algorithm" line and the
// prediction gain on its own following line. Surface both with short labels
// (consistent with the agg/min/hyst code-side labels). Returns null when
// neither gain is present (caller keeps the generic param).
const ppecParam = (xLine: string, hdr: string[]): string | null => {
  const ctrl = xLine.match(/Control gain = ([\d.]+)/)?.[1];
  const pred = firstMatch(hdr, /Prediction gain = ([\d.]+)/)?.[1];
  const parts: string[] = [];
  if (ctrl) parts.push(`ctrl ${tidyNum(ctrl)}`);
  if (pred) parts.push(`pred ${tidyNum(pred)}`);
  return parts.length ? parts.join(' · ') : null;
};
```

- [ ] **Step 5: Wire exposure, AO, and PPEC into parseGuideHeader**

In `web/src/parser/guideHeader.ts`, replace the final `return { … }` block of `parseGuideHeader` (the one starting `return {` with `pierSide,` … `ra: parseAlgo(...)`) with:

```ts
  const xLine = hdr.find((l) => l.startsWith('X guide algorithm'));
  let ra = parseAlgo(xLine);
  if (ra && ra.name === 'Predictive PEC' && xLine) {
    ra = { ...ra, param: ppecParam(xLine, hdr) ?? ra.param };
  }

  const exposure = firstMatch(hdr, /Exposure = (\d+) ms/)?.[1] ?? null;
  const aoPresent = hdr.some((l) => l.startsWith('AO = '));

  return {
    pierSide,
    hourAngle,
    declination,
    altitude,
    azimuth,
    rotator,
    backlash,
    ra,
    dec: parseAlgo(hdr.find((l) => l.startsWith('Y guide algorithm'))),
    exposure,
    aoPresent,
  };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && npx vitest run src/parser/__tests__/guideHeader.test.ts`
Expected: PASS (new cases + updated all-null test).

- [ ] **Step 7: Commit**

```bash
git add web/src/parser/guideHeader.ts web/src/parser/__tests__/guideHeader.test.ts
git commit -m "feat: parse exposure, AO presence, and PPEC dual-gain from the guide header"
```

---

## Task 4: GuidingDashboard — Exposure + AO tiles + i18n

**Files:**
- Modify: `web/src/components/GuidingDashboard.tsx`
- Modify: `web/src/i18n/locales/{en,es,de,fr,it,zh}/sections.json`

(PPEC needs no component change — it flows through `info.ra.param` into the existing `algoSub`.)

- [ ] **Step 1: Add the i18n caption keys (all 6 locales)**

In each `…/sections.json`, add three keys inside the `"dashboard"` object (next to `"pierSide"`). Values per locale:

| key | en | es | de | fr | it | zh |
|---|---|---|---|---|---|---|
| `exposure` | Exposure | Exposición | Belichtung | Exposition | Esposizione | 曝光 |
| `aoUnit` | AO Unit | Unidad AO | AO-Einheit | Unité AO | Unità AO | AO 单元 |
| `aoPresent` | Present | Presente | Vorhanden | Présent | Presente | 存在 |

Example for `en/sections.json` (add after the `"pierSide": "Pier side",` line):

```json
    "exposure": "Exposure",
    "aoUnit": "AO Unit",
    "aoPresent": "Present",
```

- [ ] **Step 2: Update the `hasAny` guard**

In `web/src/components/GuidingDashboard.tsx`, extend the `hasAny` expression so a header with only exposure/AO still renders:

```ts
  const hasAny =
    info.pierSide || info.hourAngle || info.altitude || info.rotator ||
    info.backlash || info.ra || info.dec || info.exposure || info.aoPresent;
```

- [ ] **Step 3: Render the Exposure and AO tiles**

In `web/src/components/GuidingDashboard.tsx`, inside the returned tile row, add the Exposure tile immediately after the Pier side tile:

```tsx
      {info.pierSide && <Tile caption={t('dashboard.pierSide')} value={info.pierSide} />}
      {info.exposure && <Tile caption={t('dashboard.exposure')} value={`${Number(info.exposure) / 1000} s`} />}
```

And add the AO tile immediately after the rotator tile:

```tsx
      {info.rotator && <Tile caption={t('dashboard.rotator')} value={`${info.rotator}°`} />}
      {info.aoPresent && <Tile caption={t('dashboard.aoUnit')} value={t('dashboard.aoPresent')} />}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/GuidingDashboard.tsx web/src/i18n/locales
git commit -m "feat: Exposure and AO tiles on the guiding dashboard (PPEC gains flow through)"
```

---

## Task 5: StatsGrid eccentricity badge + i18n

**Files:**
- Modify: `web/src/components/StatsGrid.tsx`
- Modify: `web/src/i18n/locales/{en,es,de,fr,it,zh}/stats.json`

- [ ] **Step 1: Add the i18n label key (all 6 locales)**

In each `…/stats.json`, add to the `"guide"` object (kept short, like RMS/PAE — same string in every locale):

```json
    "eccentricity": "Ecc",
```

- [ ] **Step 2: Import the helpers and fmt**

At the top of `web/src/components/StatsGrid.tsx`, add the eccBand import (next to the existing imports):

```ts
import { eccBand, ECC_BAND_CLASSES } from './eccBand';
```

- [ ] **Step 3: Add a `trailing` slot to the `Row` component**

In `web/src/components/StatsGrid.tsx`, change the `Row` definition to accept an optional trailing node:

```tsx
  const Row = ({ label, color, items, trailing }: { label: string; color?: string; items: [string, string][]; trailing?: React.ReactNode }) => (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
      <span className={`w-12 text-xs font-semibold uppercase tracking-wide ${color ?? 'text-slate-400'}`}>{label}</span>
      {items.map(([k, val]) => <Cell key={k} k={k} v={val} />)}
      {trailing}
    </div>
  );
```

Add the React type import if not already present — at the top of the file:

```ts
import type { ReactNode } from 'react';
```

…and use `ReactNode` instead of `React.ReactNode` in the `Row` signature:

```tsx
  const Row = ({ label, color, items, trailing }: { label: string; color?: string; items: [string, string][]; trailing?: ReactNode }) => (
```

- [ ] **Step 4: Build the eccentricity badge and put it in the Total row**

In `web/src/components/StatsGrid.tsx`, just before the `return (` of the component, compute the badge:

```tsx
  const ecc = s.ecc;
  const eccBadge = (
    <button
      className={`flex items-baseline gap-1 rounded px-1.5 py-0.5 ${ECC_BAND_CLASSES[eccBand(ecc)]} hover:opacity-90`}
      onClick={() => copy(fmt(ecc, 2))}
      title={t('eccentricityTooltip', { value: fmt(ecc, 2), ra: v(s.rmsRa), dec: v(s.rmsDec) })}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-90">{t('guide.eccentricity')}</span>
      <span className="font-mono">{fmt(ecc, 2)}</span>
    </button>
  );
```

Then pass it to the Total row:

```tsx
      <Row label={t('rows.total')} items={common} trailing={eccBadge} />
```

- [ ] **Step 5: Add the tooltip i18n key (all 6 locales)**

In each `…/stats.json`, add a top-level key (sibling of `"guide"`, alongside the existing `"copyTooltip"`):

```json
  "eccentricityTooltip": "Eccentricity {{value}} — elongation of the RA/Dec scatter (0 = round, 1 = a line). RA {{ra}} / Dec {{dec}}",
```

For non-en locales use the same interpolation structure; acceptable per-locale strings:

| locale | string |
|---|---|
| es | `Excentricidad {{value}} — elongación de la dispersión RA/Dec (0 = redonda, 1 = una línea). RA {{ra}} / Dec {{dec}}` |
| de | `Exzentrizität {{value}} — Elongation der RA/Dec-Streuung (0 = rund, 1 = eine Linie). RA {{ra}} / Dec {{dec}}` |
| fr | `Excentricité {{value}} — allongement de la dispersion RA/Dec (0 = ronde, 1 = une ligne). RA {{ra}} / Dec {{dec}}` |
| it | `Eccentricità {{value}} — allungamento della dispersione RA/Dec (0 = rotonda, 1 = una linea). RA {{ra}} / Dec {{dec}}` |
| zh | `偏心率 {{value}} — RA/Dec 散布的拉长程度（0 = 圆形，1 = 直线）。RA {{ra}} / Dec {{dec}}` |

- [ ] **Step 6: Typecheck + run the focused tests**

Run: `cd web && npx tsc --noEmit && npx vitest run src/components/__tests__/eccBand.test.ts src/parser/__tests__/stats.test.ts`
Expected: clean typecheck; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/StatsGrid.tsx web/src/i18n/locales
git commit -m "feat: color-coded eccentricity badge in the StatsGrid Total row"
```

---

## Task 6: Full verification + PR

- [ ] **Step 1: Typecheck + full test suite**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; all tests pass (≈263 prior + new cases).

- [ ] **Step 2: Browser verification**

Start the dev server if not running (`cd web && npm run dev`), open `http://localhost:5173/phd2-log-viewer-web/`, load a sample log that uses Predictive PEC (e.g. one of the `sample data/*.txt` whose header has `Predictive PEC`), and confirm:
- Guiding dashboard shows an **Exposure** tile (e.g. `2 s`).
- On the PPEC section, the RA tile reads `Predictive PEC · ctrl … · pred …`.
- The StatsGrid Total row shows the **Ecc** badge with the right color band; switch themes (Dark + one light theme) and confirm the badge text stays readable.
- (No AO sample exists — exercise the AO tile by temporarily injecting an `AO = test` line via the browser console / a scratch log if practical; otherwise rely on the Task 3 unit test and note it.)

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/dashboard-exposure-ppec-ao-eccentricity
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "feat: guiding-dashboard exposure/PPEC/AO tiles + StatsGrid eccentricity" --body "<summary + test evidence>"
```

- [ ] **Step 4: Merge per the auto-merge policy (coding PR, tests green)**

```bash
gh api -X PUT repos/bvalente22/phd2-log-viewer-web/pulls/<N>/merge -f merge_method=squash
git checkout main && git pull --ff-only
```

---

## Self-Review

**Spec coverage:**
- Exposure tile → Task 3 (parse) + Task 4 (render). ✓
- PPEC dual gains → Task 3 (`ppecParam`, `ra.param`) + flows through existing `algoSub`. ✓
- AO "Present" tile → Task 3 (`aoPresent`) + Task 4 (render). ✓
- Eccentricity formula → Task 1 (`calcStats.ecc`). ✓
- Eccentricity badge + color bands + readable text → Task 2 (`eccBand`/classes) + Task 5 (badge). ✓
- i18n across 6 locales → Tasks 4 & 5. ✓
- Tests → Tasks 1–3 (vitest) + Task 6 (browser). ✓

**Placeholder scan:** Every code step shows full code. The PR body `<summary>` and merge `<N>` are runtime values, not code placeholders.

**Type consistency:** `SessionStats.ecc` (Task 1) is read as `s.ecc` (Task 5). `eccBand`/`ECC_BAND_CLASSES` (Task 2) imported and used (Task 5). `GuideHeaderInfo.exposure`/`aoPresent` (Task 3) read as `info.exposure`/`info.aoPresent` (Task 4). `ppecParam`/`tidyNum`/`firstMatch` all defined in `guideHeader.ts`. Consistent.
