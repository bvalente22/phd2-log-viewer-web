# Image Impact panel + Aspect Ratio de-emphasis

Date: 2026-06-12
Status: Approved (design, validated via visual-companion mockups v1→v3)

## Summary

Add an **Image Impact** panel to the right of the session-stats footer on guiding
sections. It estimates how RA/Dec guide-error asymmetry may elongate stars in the
imaging scope, by combining the (already-arcsec) RA/Dec guide RMS with a base seeing
FWHM in quadrature. Two persisted inputs — **Imaging scale** (arcsec/pixel) and
**Estimated Seeing** (preset + override) — drive a guide-error ellipse and an
estimated final-star ellipse, with the estimated eccentricity shown as a quiet caption.

Also: **de-emphasize the Aspect Ratio** in the stats summary — render it as a plain
Total-row cell (like RMS / Duration / PAE), dropping the colored stoplight badge.

Scope: guiding sections only. The calibration view is untouched.

## Reference

Algorithm and visualization modeled on the user's `imagingEstimator/guideEccChatGPT.html`
(untracked reference). The web app already has RA/Dec RMS in arcseconds
(`SessionStats.rmsRaArcsec` / `rmsDecArcsec`), so the app needs only the two imaging
inputs. Guide image scale (a diagnostic in the reference) is not needed and not shown.

## Part 1 — Aspect Ratio de-emphasis ([StatsGrid.tsx](../../../web/src/components/StatsGrid.tsx))

Today the aspect-ratio metric renders as a stoplight-colored pill (`metricBadge`, via
`guidingMetric` + `BAND_CLASSES`). Change it to a plain cell appended to the Total row's
`common` items, styled exactly like the other cells (muted label + mono value,
click-to-copy):

- Value: `guidingMetric.compute(rmsRa, rmsDec)` → `fmt(value, 2)`, or `—` when null.
- Label: `t(guidingMetric.labelKey)` ("Aspect Ratio").
- Remove the `metricBadge` JSX, the `trailing` prop on the Total `Row`, and the
  `BAND_CLASSES` import. `guidingMetric` is still imported (for compute + label).

The `band` / `BAND_CLASSES` in `guidingMetric.ts` stay (used by the dormant
`eccentricityMetric` and available if a colored treatment is wanted again). The
`aspectRatioTooltip` i18n key becomes unused but is left in place (harmless).

## Part 2 — Image Impact panel

### Inputs (persisted globally in viewStore → localStorage)

Two new persisted fields on `useViewStore`, added to `partialize` so they survive
sessions (rig settings, not per-log):

- `imagingScale: number` (arcsec/pixel), default `1.0`.
- `seeingFwhm: number` (arcsec), default `3.0` (OK Seeing midpoint).

Setters `setImagingScale(n)` / `setSeeingFwhm(n)`.

**Estimated Seeing** is a `<select>` of presets plus a numeric override box. Selecting a
preset writes its midpoint to `seeingFwhm`; editing the override sets `seeingFwhm`
directly. The selected `<option>` is **derived** from `seeingFwhm` (matches a preset
midpoint within 1e-6 → that preset, else "Custom") — single source of truth, no separate
"which preset" state.

Seeing presets (midpoint of each range), as a pure constant `SEEING_PRESETS`:

| key | midpoint FWHM (″) | range |
|---|---|---|
| exceptional | 0.75 | 0.5–1″ |
| good | 1.50 | 1–2″ |
| ok | 3.00 | 2–4″ |
| poor | 4.50 | 4–5″ |
| veryPoor | 5.50 | 5–6″ |

Helper `presetForFwhm(fwhm): string` → preset key or `'custom'`.

### Calculation (pure module `web/src/parser/imageImpact.ts`)

```ts
const FWHM_PER_SIGMA = 2.355;

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

// Returns null when any input is <= 0 (empty selection or unset fields).
export function computeImageImpact(
  raRmsArcsec: number, decRmsArcsec: number, imagingScale: number, fwhmArcsec: number,
): ImageImpactResult | null;
```

Formulas (matching the reference; `safeSqrt(x) = sqrt(max(0, x))` guards FP noise):

```
major = max(ra, dec);  minor = min(ra, dec);  dominantAxis = ra >= dec ? 'RA' : 'Dec'
baseSigma  = fwhm / 2.355
sigmaMajor = safeSqrt(baseSigma^2 + major^2)
sigmaMinor = safeSqrt(baseSigma^2 + minor^2)
estimatedEccentricity = safeSqrt(1 - (sigmaMinor / sigmaMajor)^2)
finalFwhmMajorArcsec  = sigmaMajor * 2.355
finalFwhmMinorArcsec  = sigmaMinor * 2.355
finalFwhm{Major,Minor}Px = finalFwhm{Major,Minor}Arcsec / imagingScale
```

Worked example (ra 0.75, dec 0.55, imagingScale 0.80, fwhm 3.00): dominant RA,
final FWHM 3.481″ × 3.268″ (4.35 × 4.08 px), estimated eccentricity 0.345.

### Component `web/src/components/ImageImpact.tsx`

Renders nothing on non-guiding sections. Reads the current section's stats the same way
StatsGrid does (`useMemo(calcStats(session, mask))` from `log` / `selectedSection` /
`exclusions`), giving `rmsRaArcsec` / `rmsDecArcsec`. Reads `imagingScale` / `seeingFwhm`
from viewStore. Computes via `computeImageImpact`.

Layout (matches approved mockup v3):
- Title "Image Impact".
- Inputs row: **Imaging scale** number (suffix "″/px") + **Estimated Seeing**
  (`<select>` presets + override number box, suffix "″").
- Two side-by-side SVG ellipse visuals (RA horizontal, Dec vertical):
  - **Guiding error** — single ellipse normalized to fit; wider when RA-dominant,
    taller when Dec-dominant. Corner labels `RA <maj/min>″` / `Dec <…>″`.
    Caption: `Guiding error · <dominant>-dominant`.
  - **Final star** — dashed green base-FWHM circle + solid blue final ellipse, both on a
    common scale (base circle sits inside, since finalFwhmMinor ≥ baseFwhm), so the size
    growth is visible. Caption: `Final star — FWHM <maj>″ × <min>″ (<majpx> × <minpx> px)
    · est. eccentricity <e>` (the eccentricity is muted, not highlighted).
- When `computeImageImpact` returns null (empty selection / unset input): show the inputs
  plus a muted "No guiding data to estimate" line, no ellipses.

SVG geometry (presentational, in-component):
- `cx, cy` center; `maxR` ~ 40–52px; `minVisualR` floor so a near-round ellipse is still
  visible.
- Guide: `scale = maxR / major`; `rx = (RA value)*scale`, `ry = (Dec value)*scale` where
  the RA/Dec values are major/minor assigned by `dominantAxis`.
- Final: `scale = maxR / finalFwhmMajorArcsec`; base circle `r = baseFwhmArcsec*scale`;
  ellipse `rx/ry` from finalFwhmMajor/Minor mapped to RA/Dec by `dominantAxis`.

### Layout placement ([ViewerPage.tsx](../../../web/src/pages/ViewerPage.tsx))

The guiding stats footer wrapper becomes a horizontal flex: StatsGrid on the left
(`flex-1`), a vertical divider, ImageImpact on the right. On narrow widths it wraps
(ImageImpact drops below). The wrapper keeps the existing `border-t border-slate-700
bg-slate-800` surface.

```tsx
<div className="flex flex-wrap border-t border-slate-700 bg-slate-800">
  <div className="min-w-0 flex-1"><StatsGrid /></div>
  <ImageImpact />
</div>
```

### i18n

New `imageImpact` block in `stats.json` (all 6 locales). RA / Dec stay English.
Keys (en values): `title` "Image Impact", `imagingScale` "Imaging scale",
`estimatedSeeing` "Estimated Seeing", `seeingValueTitle` "Seeing FWHM (arcsec)",
`presetExceptional`/`presetGood`/`presetOk`/`presetPoor`/`presetVeryPoor`/`presetCustom`,
`guidingError` "Guiding error", `dominant` "{{axis}}-dominant", `finalStar` "Final star",
`finalFwhm` "FWHM {{major}}″ × {{minor}}″ ({{majorpx}} × {{minorpx}} px)",
`eccentricity` "est. eccentricity {{value}}", `noData` "No guiding data to estimate",
`tooltip` "Estimate of how RA/Dec guide-error asymmetry may elongate stars in the imaging
scope after combining with seeing. An estimate only — real star shape also depends on
optics, focus, flexure, wind, and processing."

## Testing

- `imageImpact.test.ts`: `computeImageImpact` worked example (0.75/0.55/0.80/3.00 →
  dominant RA, final FWHM ≈3.481×3.268, px ≈4.35×4.08, ecc ≈0.345); Dec-dominant case
  (swap → dominant Dec, same magnitudes); guard (any input ≤0 → null); a high-asymmetry
  case. `presetForFwhm`: 3.0→'ok', 0.75→'exceptional', 2.2→'custom'.
- Browser verification on a real guiding log: panel renders to the right of stats, both
  ellipses draw, RA-dominant ellipse is wider; change imaging scale / seeing and confirm
  the final ellipse + caption update; reload and confirm the two inputs persist; confirm
  the Aspect Ratio now reads as a plain Total-row cell. Check one light theme for
  readability.

## Out of scope / non-goals

- Guide-pixel diagnostics, RA/Dec-in-imaging-pixels rows, copy-results button (reference
  extras the user dropped).
- Camera-rotation projection (ellipses are conceptual: RA horizontal, Dec vertical).
- Any change to the calibration view, the dashboard, or the guiding chart.
- A user-facing toggle for the metric or the estimator model.
