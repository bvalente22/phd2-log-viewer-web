# Image Impact panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Image Impact panel to the right of the guiding-section stats footer that estimates star elongation from RA/Dec guide RMS + seeing FWHM, with two persisted inputs and guide/final-star ellipse visuals; and de-emphasize the Aspect Ratio to a plain stat cell.

**Architecture:** A pure compute module (`imageImpact.ts`) holds the model + seeing presets and is unit-tested. The view store gains two persisted rig inputs. A new `ImageImpact.tsx` component renders the inputs + two SVG ellipses, deriving RA/Dec arcsec RMS from `calcStats` exactly like StatsGrid. The stats footer in `ViewerPage` becomes a flex row (stats | image impact). StatsGrid drops the colored aspect-ratio badge for a plain cell.

**Tech Stack:** TypeScript, React, Zustand (persist), react-i18next, Tailwind, vitest. Commands run from `web/`.

**Spec:** `docs/superpowers/specs/2026-06-12-image-impact-panel-design.md`

---

## File Structure

- `web/src/parser/imageImpact.ts` — NEW: `FWHM_PER_SIGMA`, `SEEING_PRESETS`, `presetForFwhm`, `ImageImpactResult`, `computeImageImpact`.
- `web/src/parser/__tests__/imageImpact.test.ts` — NEW.
- `web/src/state/viewStore.ts` — add `imagingScale` / `seeingFwhm` + setters + persist.
- `web/src/i18n/locales/{en,es,de,fr,it,zh}/stats.json` — add the `imageImpact` block.
- `web/src/components/ImageImpact.tsx` — NEW: the panel (inputs + two ellipse SVGs).
- `web/src/components/StatsGrid.tsx` — aspect ratio becomes a plain Total-row cell.
- `web/src/pages/ViewerPage.tsx` — footer becomes flex; render `<ImageImpact/>`.

---

## Task 1: Image Impact compute module

**Files:**
- Create: `web/src/parser/imageImpact.ts`
- Test: `web/src/parser/__tests__/imageImpact.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/parser/__tests__/imageImpact.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeImageImpact, presetForFwhm, SEEING_PRESETS } from '../imageImpact';

describe('computeImageImpact', () => {
  it('worked example is RA-dominant with the expected final shape', () => {
    const r = computeImageImpact(0.75, 0.55, 0.80, 3.00)!;
    expect(r.dominantAxis).toBe('RA');
    expect(r.majorRmsArcsec).toBeCloseTo(0.75);
    expect(r.minorRmsArcsec).toBeCloseTo(0.55);
    expect(r.finalFwhmMajorArcsec).toBeCloseTo(3.481, 2);
    expect(r.finalFwhmMinorArcsec).toBeCloseTo(3.268, 2);
    expect(r.finalFwhmMajorPx).toBeCloseTo(4.352, 2);
    expect(r.finalFwhmMinorPx).toBeCloseTo(4.085, 2);
    expect(r.estimatedEccentricity).toBeCloseTo(0.345, 2);
    expect(r.baseFwhmArcsec).toBe(3.00);
  });

  it('is Dec-dominant when Dec RMS is larger; magnitudes mirror', () => {
    const r = computeImageImpact(0.55, 0.75, 0.80, 3.00)!;
    expect(r.dominantAxis).toBe('Dec');
    expect(r.majorRmsArcsec).toBeCloseTo(0.75);
    expect(r.estimatedEccentricity).toBeCloseTo(0.345, 2);
  });

  it('equal axes -> eccentricity 0', () => {
    const r = computeImageImpact(0.6, 0.6, 1, 2)!;
    expect(r.estimatedEccentricity).toBeCloseTo(0);
  });

  it('returns null when any input is <= 0', () => {
    expect(computeImageImpact(0, 0.5, 1, 3)).toBeNull();
    expect(computeImageImpact(0.5, 0.5, 0, 3)).toBeNull();
    expect(computeImageImpact(0.5, 0.5, 1, 0)).toBeNull();
  });
});

describe('presetForFwhm', () => {
  it('matches preset midpoints, else custom', () => {
    expect(presetForFwhm(3.0)).toBe('ok');
    expect(presetForFwhm(0.75)).toBe('exceptional');
    expect(presetForFwhm(5.5)).toBe('veryPoor');
    expect(presetForFwhm(2.2)).toBe('custom');
  });
  it('SEEING_PRESETS lists the five tiers in order', () => {
    expect(SEEING_PRESETS.map((p) => p.key)).toEqual(['exceptional', 'good', 'ok', 'poor', 'veryPoor']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/parser/__tests__/imageImpact.test.ts`
Expected: FAIL — cannot find module `../imageImpact`.

- [ ] **Step 3: Create the module**

Create `web/src/parser/imageImpact.ts`:

```ts
// Estimate how asymmetric RA/Dec guide RMS may elongate stars in an imaging
// scope, by combining the (already-arcsec) guide RMS with a base seeing FWHM in
// quadrature. Pure + presentation-free so the model is unit-testable. Modeled on
// imagingEstimator/guideEccChatGPT.html. Guide image scale is NOT needed here:
// the RMS are already in arcseconds, so it would only convert to guide pixels,
// which this panel does not show.

const FWHM_PER_SIGMA = 2.355; // Gaussian FWHM = 2.355 * sigma

export interface SeeingPreset {
  key: string;   // i18n suffix: imageImpact.preset_<key>
  fwhm: number;  // midpoint FWHM of the seeing range, arcsec
}

// Midpoint of each seeing range (see the spec table).
export const SEEING_PRESETS: SeeingPreset[] = [
  { key: 'exceptional', fwhm: 0.75 },
  { key: 'good', fwhm: 1.5 },
  { key: 'ok', fwhm: 3.0 },
  { key: 'poor', fwhm: 4.5 },
  { key: 'veryPoor', fwhm: 5.5 },
];

/** Preset key whose midpoint equals `fwhm` (within 1e-6), else 'custom'. */
export function presetForFwhm(fwhm: number): string {
  const hit = SEEING_PRESETS.find((p) => Math.abs(p.fwhm - fwhm) < 1e-6);
  return hit ? hit.key : 'custom';
}

export interface ImageImpactResult {
  dominantAxis: 'RA' | 'Dec';
  majorRmsArcsec: number;        // max(ra, dec)
  minorRmsArcsec: number;        // min(ra, dec)
  finalFwhmMajorArcsec: number;
  finalFwhmMinorArcsec: number;
  finalFwhmMajorPx: number;
  finalFwhmMinorPx: number;
  estimatedEccentricity: number; // [0,1)
  baseFwhmArcsec: number;        // = input fwhm (dashed base circle)
}

const safeSqrt = (x: number) => Math.sqrt(Math.max(0, x));

/**
 * Returns the estimated star-shape model, or null when any input is <= 0 (empty
 * selection or an unset field) — the caller renders a "no data" hint then.
 */
export function computeImageImpact(
  raRmsArcsec: number,
  decRmsArcsec: number,
  imagingScale: number,
  fwhmArcsec: number,
): ImageImpactResult | null {
  if (!(raRmsArcsec > 0) || !(decRmsArcsec > 0) || !(imagingScale > 0) || !(fwhmArcsec > 0)) {
    return null;
  }
  const major = Math.max(raRmsArcsec, decRmsArcsec);
  const minor = Math.min(raRmsArcsec, decRmsArcsec);
  const dominantAxis: 'RA' | 'Dec' = raRmsArcsec >= decRmsArcsec ? 'RA' : 'Dec';

  const baseSigma = fwhmArcsec / FWHM_PER_SIGMA;
  const sigmaMajor = safeSqrt(baseSigma * baseSigma + major * major);
  const sigmaMinor = safeSqrt(baseSigma * baseSigma + minor * minor);

  const estimatedEccentricity = safeSqrt(1 - (sigmaMinor / sigmaMajor) ** 2);
  const finalFwhmMajorArcsec = sigmaMajor * FWHM_PER_SIGMA;
  const finalFwhmMinorArcsec = sigmaMinor * FWHM_PER_SIGMA;

  return {
    dominantAxis,
    majorRmsArcsec: major,
    minorRmsArcsec: minor,
    finalFwhmMajorArcsec,
    finalFwhmMinorArcsec,
    finalFwhmMajorPx: finalFwhmMajorArcsec / imagingScale,
    finalFwhmMinorPx: finalFwhmMinorArcsec / imagingScale,
    estimatedEccentricity,
    baseFwhmArcsec: fwhmArcsec,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/parser/__tests__/imageImpact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/parser/imageImpact.ts web/src/parser/__tests__/imageImpact.test.ts
git commit -m "feat: Image Impact estimator model (pure compute + seeing presets)"
```

---

## Task 2: Persisted view-store inputs

**Files:**
- Modify: `web/src/state/viewStore.ts`

These are global rig settings (not per-log), so they go in `partialize`. No dedicated test — trivial plumbing, exercised in browser (matches how the other setters were added).

- [ ] **Step 1: Add interface fields**

In `web/src/state/viewStore.ts`, in the `ViewState` interface, add after `swapRaDec: boolean;`:

```ts
  /**
   * Imaging-scope settings for the Image Impact panel. Persisted across
   * sessions because they describe the user's imaging rig, not a log.
   * `imagingScale` is arcsec/pixel; `seeingFwhm` is the base seeing FWHM in
   * arcseconds (preset midpoint or a custom override).
   */
  imagingScale: number;
  seeingFwhm: number;
```

And add to the setters block after `setSwapRaDec: (b: boolean) => void;`:

```ts
  setImagingScale: (n: number) => void;
  setSeeingFwhm: (n: number) => void;
```

- [ ] **Step 2: Add defaults + setters**

In `web/src/state/viewStore.ts`, in the store body after `swapRaDec: false,` add:

```ts
  imagingScale: 1.0,
  seeingFwhm: 3.0,
```

And after `setSwapRaDec: (b) => set({ swapRaDec: b }),` add:

```ts
  setImagingScale: (n) => set({ imagingScale: n }),
  setSeeingFwhm: (n) => set({ seeingFwhm: n }),
```

- [ ] **Step 3: Persist them**

In the `partialize` object at the bottom, add after `swapRaDec: s.swapRaDec,`:

```ts
    imagingScale: s.imagingScale,
    seeingFwhm: s.seeingFwhm,
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/viewStore.ts
git commit -m "feat: persist imaging scale + estimated seeing in the view store"
```

---

## Task 3: i18n — imageImpact block (6 locales)

**Files:**
- Modify: `web/src/i18n/locales/{en,es,de,fr,it,zh}/stats.json`

In each `…/stats.json`, insert a new top-level `"imageImpact"` object immediately
before the existing `"calibration": {` line (present in all six). Use the locale's
values below.

- [ ] **Step 1: en** — replace `  "calibration": {` with:

```json
  "imageImpact": {
    "title": "Image Impact",
    "tooltip": "Estimate of how RA/Dec guide-error asymmetry may elongate stars in the imaging scope after combining with seeing. An estimate only — real star shape also depends on optics, focus, flexure, wind, and processing.",
    "imagingScale": "Imaging scale",
    "estimatedSeeing": "Estimated Seeing",
    "seeingValueTitle": "Seeing FWHM (arcsec)",
    "preset_exceptional": "Exceptional (0.5–1″)",
    "preset_good": "Good (1–2″)",
    "preset_ok": "OK Seeing (2–4″)",
    "preset_poor": "Poor (4–5″)",
    "preset_veryPoor": "Very Poor (5–6″)",
    "preset_custom": "Custom",
    "guidingError": "Guiding error",
    "dominant": "{{axis}}-dominant",
    "finalStar": "Final star",
    "finalFwhm": "FWHM {{major}}″ × {{minor}}″ ({{majorpx}} × {{minorpx}} px)",
    "eccentricity": "est. eccentricity {{value}}",
    "noData": "No guiding data to estimate"
  },
  "calibration": {
```

- [ ] **Step 2: es** — replace `  "calibration": {` with:

```json
  "imageImpact": {
    "title": "Impacto en la imagen",
    "tooltip": "Estimación de cómo la asimetría del error de guiado RA/Dec puede alargar las estrellas en el telescopio de imagen al combinarse con el seeing. Solo una estimación: la forma real también depende de óptica, enfoque, flexión, viento y procesado.",
    "imagingScale": "Escala de imagen",
    "estimatedSeeing": "Seeing estimado",
    "seeingValueTitle": "FWHM del seeing (arcsec)",
    "preset_exceptional": "Excepcional (0.5–1″)",
    "preset_good": "Bueno (1–2″)",
    "preset_ok": "Aceptable (2–4″)",
    "preset_poor": "Pobre (4–5″)",
    "preset_veryPoor": "Muy pobre (5–6″)",
    "preset_custom": "Personalizado",
    "guidingError": "Error de guiado",
    "dominant": "{{axis}} dominante",
    "finalStar": "Estrella final",
    "finalFwhm": "FWHM {{major}}″ × {{minor}}″ ({{majorpx}} × {{minorpx}} px)",
    "eccentricity": "excentricidad est. {{value}}",
    "noData": "Sin datos de guiado para estimar"
  },
  "calibration": {
```

- [ ] **Step 3: de** — replace `  "calibration": {` with:

```json
  "imageImpact": {
    "title": "Bildauswirkung",
    "tooltip": "Schätzung, wie die Asymmetrie des RA/Dec-Guiding-Fehlers Sterne im Aufnahmeteleskop in Kombination mit dem Seeing verlängern kann. Nur eine Schätzung – die echte Sternform hängt auch von Optik, Fokus, Flexure, Wind und Bearbeitung ab.",
    "imagingScale": "Bildskala",
    "estimatedSeeing": "Geschätztes Seeing",
    "seeingValueTitle": "Seeing-FWHM (Bogensekunden)",
    "preset_exceptional": "Außergewöhnlich (0.5–1″)",
    "preset_good": "Gut (1–2″)",
    "preset_ok": "OK (2–4″)",
    "preset_poor": "Schlecht (4–5″)",
    "preset_veryPoor": "Sehr schlecht (5–6″)",
    "preset_custom": "Benutzerdefiniert",
    "guidingError": "Guiding-Fehler",
    "dominant": "{{axis}}-dominant",
    "finalStar": "Endstern",
    "finalFwhm": "FWHM {{major}}″ × {{minor}}″ ({{majorpx}} × {{minorpx}} px)",
    "eccentricity": "geschätzte Exzentrizität {{value}}",
    "noData": "Keine Guiding-Daten zur Schätzung"
  },
  "calibration": {
```

- [ ] **Step 4: fr** — replace `  "calibration": {` with:

```json
  "imageImpact": {
    "title": "Impact sur l'image",
    "tooltip": "Estimation de la façon dont l'asymétrie de l'erreur de guidage RA/Dec peut allonger les étoiles dans le télescope d'imagerie, combinée au seeing. Estimation seulement — la forme réelle dépend aussi de l'optique, de la mise au point, de la flexion, du vent et du traitement.",
    "imagingScale": "Échelle d'image",
    "estimatedSeeing": "Seeing estimé",
    "seeingValueTitle": "FWHM du seeing (secondes d'arc)",
    "preset_exceptional": "Exceptionnel (0.5–1″)",
    "preset_good": "Bon (1–2″)",
    "preset_ok": "Correct (2–4″)",
    "preset_poor": "Médiocre (4–5″)",
    "preset_veryPoor": "Très médiocre (5–6″)",
    "preset_custom": "Personnalisé",
    "guidingError": "Erreur de guidage",
    "dominant": "{{axis}} dominant",
    "finalStar": "Étoile finale",
    "finalFwhm": "FWHM {{major}}″ × {{minor}}″ ({{majorpx}} × {{minorpx}} px)",
    "eccentricity": "excentricité est. {{value}}",
    "noData": "Aucune donnée de guidage à estimer"
  },
  "calibration": {
```

- [ ] **Step 5: it** — replace `  "calibration": {` with:

```json
  "imageImpact": {
    "title": "Impatto sull'immagine",
    "tooltip": "Stima di quanto l'asimmetria dell'errore di guida RA/Dec possa allungare le stelle nel telescopio di ripresa, combinata con il seeing. Solo una stima — la forma reale dipende anche da ottica, fuoco, flessione, vento ed elaborazione.",
    "imagingScale": "Scala immagine",
    "estimatedSeeing": "Seeing stimato",
    "seeingValueTitle": "FWHM del seeing (arcsec)",
    "preset_exceptional": "Eccezionale (0.5–1″)",
    "preset_good": "Buono (1–2″)",
    "preset_ok": "Discreto (2–4″)",
    "preset_poor": "Scarso (4–5″)",
    "preset_veryPoor": "Molto scarso (5–6″)",
    "preset_custom": "Personalizzato",
    "guidingError": "Errore di guida",
    "dominant": "{{axis}} dominante",
    "finalStar": "Stella finale",
    "finalFwhm": "FWHM {{major}}″ × {{minor}}″ ({{majorpx}} × {{minorpx}} px)",
    "eccentricity": "eccentricità stim. {{value}}",
    "noData": "Nessun dato di guida da stimare"
  },
  "calibration": {
```

- [ ] **Step 6: zh** — replace `  "calibration": {` with:

```json
  "imageImpact": {
    "title": "成像影响",
    "tooltip": "估算 RA/Dec 导星误差的不对称在与视宁度结合后，可能使成像镜中的星点拉长的程度。仅为估算——真实星形还取决于光学、对焦、挠曲、风和后期处理。",
    "imagingScale": "成像比例",
    "estimatedSeeing": "估计视宁度",
    "seeingValueTitle": "视宁度 FWHM（角秒）",
    "preset_exceptional": "极佳 (0.5–1″)",
    "preset_good": "良好 (1–2″)",
    "preset_ok": "一般 (2–4″)",
    "preset_poor": "较差 (4–5″)",
    "preset_veryPoor": "很差 (5–6″)",
    "preset_custom": "自定义",
    "guidingError": "导星误差",
    "dominant": "{{axis}} 主导",
    "finalStar": "最终星点",
    "finalFwhm": "FWHM {{major}}″ × {{minor}}″ ({{majorpx}} × {{minorpx}} px)",
    "eccentricity": "估计偏心率 {{value}}",
    "noData": "无导星数据可估算"
  },
  "calibration": {
```

- [ ] **Step 7: Validate JSON**

Run: `cd web && node -e "for (const l of ['en','es','de','fr','it','zh']) { const j=JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'/stats.json','utf8')); if(!j.imageImpact||!j.imageImpact.title) throw new Error(l+' missing imageImpact'); console.log(l,'ok'); }"`
Expected: `en ok` … `zh ok`.

- [ ] **Step 8: Commit**

```bash
git add web/src/i18n/locales
git commit -m "i18n: Image Impact strings across 6 locales"
```

---

## Task 4: ImageImpact component

**Files:**
- Create: `web/src/components/ImageImpact.tsx`

- [ ] **Step 1: Create the component**

Create `web/src/components/ImageImpact.tsx`:

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { calcStats } from '../parser';
import {
  computeImageImpact, presetForFwhm, SEEING_PRESETS, type ImageImpactResult,
} from '../parser/imageImpact';
import { fmtNumber } from '../i18n/format';

const f2 = (n: number) => fmtNumber(n, 2);

// Shared SVG geometry for the two conceptual ellipse panels (RA horizontal,
// Dec vertical). Not a measurement plot — emphasizes shape, not absolute size.
const W = 150, H = 104, CX = 75, CY = 52, MAX_R = 46, MIN_R = 8;

function Axes() {
  return (
    <>
      <line x1={14} y1={CY} x2={W - 14} y2={CY} stroke="rgba(255,255,255,.12)" />
      <line x1={CX} y1={12} x2={CX} y2={H - 12} stroke="rgba(255,255,255,.12)" />
      <text x={W - 16} y={CY - 4} fontSize={10} fill="#94a3b8" textAnchor="end">RA</text>
      <text x={CX + 3} y={22} fontSize={10} fill="#94a3b8">Dec</text>
    </>
  );
}

// rx/ry for an ellipse whose major axis points along the dominant sky axis.
function axisRadii(major: number, minor: number, dominant: 'RA' | 'Dec') {
  const majR = Math.max(MIN_R, major);
  const minR = Math.max(MIN_R, minor);
  return dominant === 'Dec' ? { rx: minR, ry: majR } : { rx: majR, ry: minR };
}

function GuideEllipse({ r }: { r: ImageImpactResult }) {
  const { t } = useTranslation('stats');
  const scale = MAX_R / Math.max(r.majorRmsArcsec, r.minorRmsArcsec, 1e-6);
  const { rx, ry } = axisRadii(r.majorRmsArcsec * scale, r.minorRmsArcsec * scale, r.dominantAxis);
  const raVal = r.dominantAxis === 'RA' ? r.majorRmsArcsec : r.minorRmsArcsec;
  const decVal = r.dominantAxis === 'Dec' ? r.majorRmsArcsec : r.minorRmsArcsec;
  return (
    <div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('imageImpact.guidingError')}>
        <Axes />
        <ellipse cx={CX} cy={CY} rx={rx} ry={ry} fill="rgba(245,158,11,.18)" stroke="rgba(245,158,11,.9)" strokeWidth={2} />
        <text x={8} y={16} fontSize={10} fill="#94a3b8">RA {f2(raVal)}″</text>
        <text x={8} y={30} fontSize={10} fill="#94a3b8">Dec {f2(decVal)}″</text>
      </svg>
      <div className="mt-0.5 text-center text-[10px] text-slate-400">
        {t('imageImpact.guidingError')} · {t('imageImpact.dominant', { axis: r.dominantAxis })}
      </div>
    </div>
  );
}

function FinalEllipse({ r }: { r: ImageImpactResult }) {
  const { t } = useTranslation('stats');
  // Base circle + final ellipse share one scale (base sits inside, since
  // finalFwhmMinor >= baseFwhm) so the size growth reads honestly.
  const scale = MAX_R / Math.max(r.finalFwhmMajorArcsec, 1e-6);
  const { rx, ry } = axisRadii(r.finalFwhmMajorArcsec * scale, r.finalFwhmMinorArcsec * scale, r.dominantAxis);
  const baseR = Math.max(MIN_R * 0.8, r.baseFwhmArcsec * scale);
  return (
    <div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('imageImpact.finalStar')}>
        <Axes />
        <circle cx={CX} cy={CY} r={baseR} fill="none" stroke="rgba(52,211,153,.5)" strokeWidth={2} strokeDasharray="4 4" />
        <ellipse cx={CX} cy={CY} rx={rx} ry={ry} fill="rgba(143,180,255,.18)" stroke="rgba(143,180,255,.95)" strokeWidth={2} />
      </svg>
      <div className="mt-0.5 text-center text-[10px] text-slate-400">
        {t('imageImpact.finalStar')} — {t('imageImpact.finalFwhm', {
          major: f2(r.finalFwhmMajorArcsec), minor: f2(r.finalFwhmMinorArcsec),
          majorpx: f2(r.finalFwhmMajorPx), minorpx: f2(r.finalFwhmMinorPx),
        })}
        <span className="text-slate-500"> · {t('imageImpact.eccentricity', { value: f2(r.estimatedEccentricity) })}</span>
      </div>
    </div>
  );
}

/**
 * Image Impact panel — sits to the right of the StatsGrid on guiding sections.
 * Estimates star elongation from the section's RA/Dec arcsec RMS plus the user's
 * imaging scale + estimated seeing. Renders nothing on non-guiding sections.
 */
export function ImageImpact() {
  const { t } = useTranslation('stats');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);
  const imagingScale = useViewStore((s) => s.imagingScale);
  const seeingFwhm = useViewStore((s) => s.seeingFwhm);
  const setImagingScale = useViewStore((s) => s.setImagingScale);
  const setSeeingFwhm = useViewStore((s) => s.setSeeingFwhm);

  const rms = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const st = calcStats(session, exclusions.get(sec.idx));
    return { ra: st.rmsRaArcsec, dec: st.rmsDecArcsec };
  }, [log, sectionIdx, exclusions]);

  if (!rms) return null;

  const result = computeImageImpact(rms.ra, rms.dec, imagingScale, seeingFwhm);
  const preset = presetForFwhm(seeingFwhm);

  return (
    <div className="border-s border-slate-700 px-4 py-2 text-sm" title={t('imageImpact.tooltip')}>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-sky-300/80">{t('imageImpact.title')}</div>

      <div className="mb-2 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-slate-400">{t('imageImpact.imagingScale')}</span>
          <span className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-1">
            <input
              type="number" step="0.01" min="0" value={imagingScale}
              onChange={(e) => setImagingScale(Number(e.target.value))}
              className="w-14 bg-transparent font-mono text-xs text-slate-100 focus:outline-none"
            />
            <span className="text-[10px] text-slate-500">″/px</span>
          </span>
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-slate-400">{t('imageImpact.estimatedSeeing')}</span>
          <span className="flex items-center gap-1">
            <select
              value={preset}
              onChange={(e) => {
                const p = SEEING_PRESETS.find((x) => x.key === e.target.value);
                if (p) setSeeingFwhm(p.fwhm);
              }}
              className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-100 focus:outline-none"
            >
              {SEEING_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{t(`imageImpact.preset_${p.key}`)}</option>
              ))}
              <option value="custom">{t('imageImpact.preset_custom')}</option>
            </select>
            <span className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-1">
              <input
                type="number" step="0.05" min="0" value={seeingFwhm}
                title={t('imageImpact.seeingValueTitle')}
                onChange={(e) => setSeeingFwhm(Number(e.target.value))}
                className="w-12 bg-transparent font-mono text-xs text-slate-100 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500">″</span>
            </span>
          </span>
        </label>
      </div>

      {result ? (
        <div className="flex flex-wrap gap-4">
          <GuideEllipse r={result} />
          <FinalEllipse r={result} />
        </div>
      ) : (
        <div className="text-xs text-slate-500">{t('imageImpact.noData')}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no output (clean). (Component is not yet rendered anywhere — Task 6 wires it in.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ImageImpact.tsx
git commit -m "feat: ImageImpact panel component (inputs + guide/final ellipse visuals)"
```

---

## Task 5: Aspect Ratio → plain Total-row cell

**Files:**
- Modify: `web/src/components/StatsGrid.tsx`

- [ ] **Step 1: Revert the Row trailing slot + imports**

In `web/src/components/StatsGrid.tsx`, change the first import line back to:

```ts
import { useMemo } from 'react';
```

Change the metric import to drop `BAND_CLASSES`:

```ts
import { guidingMetric } from './guidingMetric';
```

Restore the `Row` component to its no-trailing form:

```tsx
  const Row = ({ label, color, items }: { label: string; color?: string; items: [string, string][] }) => (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
      <span className={`w-12 text-xs font-semibold uppercase tracking-wide ${color ?? 'text-slate-400'}`}>{label}</span>
      {items.map(([k, val]) => <Cell key={k} k={k} v={val} />)}
    </div>
  );
```

- [ ] **Step 2: Delete the badge block**

In `web/src/components/StatsGrid.tsx`, delete the entire `metricBadge` block (the `// Guiding metric badge …` comment and the `const metric = …` through the closing `);` of `const metricBadge`).

- [ ] **Step 3: Append aspect ratio as a plain cell**

In `web/src/components/StatsGrid.tsx`, change the `common` array to include the aspect ratio as a final cell:

```tsx
  const arVal = guidingMetric.compute(s.rmsRa, s.rmsDec);
  const common: [string, string][] = [
    [t('guide.rms'), v(s.rmsTotal)],
    [t('guide.duration'), `${fmtRoundedInt(s.durationSec)} ${t('guide.secondsSuffix')}`],
    [t('guide.included'), fmtInteger(s.includedCount)],
    [t('guide.excluded'), fmtInteger(s.excludedCount)],
    [t('guide.pae'), `${fmt(s.paeArcMin, 2)}′`],
    [t(guidingMetric.labelKey), arVal === null ? '—' : fmt(arVal, 2)],
  ];
```

- [ ] **Step 4: Drop the trailing prop from the Total row**

In `web/src/components/StatsGrid.tsx`, change:

```tsx
      <Row label={t('rows.total')} items={common} trailing={metricBadge} />
```

to:

```tsx
      <Row label={t('rows.total')} items={common} />
```

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no output (clean). No remaining references to `metricBadge`, `BAND_CLASSES`, `eccBand`, or `ReactNode`.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/StatsGrid.tsx
git commit -m "feat: de-emphasize Aspect Ratio to a plain Total-row cell (no stoplight pill)"
```

---

## Task 6: Wire the panel into the footer

**Files:**
- Modify: `web/src/pages/ViewerPage.tsx`

- [ ] **Step 1: Import the component**

In `web/src/pages/ViewerPage.tsx`, add after the `import { StatsGrid } …` line:

```ts
import { ImageImpact } from '../components/ImageImpact';
```

- [ ] **Step 2: Make the footer a flex row**

In `web/src/pages/ViewerPage.tsx`, replace:

```tsx
            <div className="border-t border-slate-700 bg-slate-800">
              <StatsGrid />
            </div>
```

with:

```tsx
            <div className="flex flex-wrap border-t border-slate-700 bg-slate-800">
              <div className="min-w-0 flex-1">
                <StatsGrid />
              </div>
              <ImageImpact />
            </div>
```

- [ ] **Step 3: Typecheck + run the focused parser tests**

Run: `cd web && npx tsc --noEmit && npx vitest run src/parser/__tests__/imageImpact.test.ts`
Expected: clean typecheck; tests PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/ViewerPage.tsx
git commit -m "feat: render Image Impact panel beside the guiding stats footer"
```

---

## Task 7: Full verification + PR

- [ ] **Step 1: Typecheck + full suite**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; all tests pass (276 prior + new imageImpact cases).

- [ ] **Step 2: Browser verification**

Dev server on `http://localhost:5173/phd2-log-viewer-web/`. Load a guiding log (e.g.
`QuarkPHD2_GuideLog_2026-06-05_223909.txt`), select a guiding section, and confirm:
- The Image Impact panel renders to the right of the stats; both ellipses draw.
- RA-dominant section → guide-error ellipse is wider than tall.
- Change Imaging scale and Estimated Seeing (preset + override) → the final ellipse, the
  FWHM/eccentricity caption, and the preset/Custom selection update live.
- Reload the page → the two inputs persist.
- Aspect Ratio now reads as a plain `Aspect Ratio 1.37` cell in the Total row (no pill).
- Switch to a light theme → panel + ellipse labels stay readable.

- [ ] **Step 3: Push + open the PR**

```bash
git push -u origin feat/image-impact-panel
git merge-base --is-ancestor origin/main HEAD || { echo "DIVERGED — stop"; exit 1; }
gh pr create --title "feat: Image Impact panel (guide-error → star elongation estimator)" --body "<summary + test evidence>"
```

- [ ] **Step 4: Merge per the auto-merge policy (coding PR, tests green)**

```bash
gh api -X PUT repos/bvalente22/phd2-log-viewer-web/pulls/<N>/merge -f merge_method=squash
git checkout main && git pull --ff-only   # if "File exists" hiccup: git reset --hard origin/main
```

---

## Self-Review

**Spec coverage:**
- Compute model + presets → Task 1. ✓
- Persisted imaging scale + seeing inputs → Task 2. ✓
- i18n (6 locales, imageImpact block) → Task 3. ✓
- Panel: inputs (imaging scale + estimated seeing preset/override), two ellipse visuals,
  muted eccentricity caption, FWHM arcsec+px, no-data state → Task 4. ✓
- Aspect Ratio de-emphasis to plain cell → Task 5. ✓
- Layout to the right of stats footer → Task 6. ✓
- Tests (compute, presets) + browser verification → Tasks 1 & 7. ✓

**Placeholder scan:** All code steps are complete. `<summary>`/`<N>` in Task 7 are runtime values.

**Type consistency:** `computeImageImpact`/`presetForFwhm`/`SEEING_PRESETS`/`ImageImpactResult` (Task 1) imported in Task 4. `imagingScale`/`seeingFwhm`/`setImagingScale`/`setSeeingFwhm` (Task 2) used in Task 4. i18n keys `imageImpact.*` (Task 3) referenced by the component (Task 4) — `preset_${key}` matches keys `exceptional|good|ok|poor|veryPoor` + `preset_custom`. `guidingMetric.compute`/`labelKey` (existing) used in Task 5; `BAND_CLASSES`/`metricBadge`/`trailing`/`ReactNode` fully removed. `ImageImpact` (Task 4) imported + rendered in Task 6. Consistent.
