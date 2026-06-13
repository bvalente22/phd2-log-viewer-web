# Per-log imaging settings + "remember settings" + interpretation tooltips

Date: 2026-06-12
Status: Approved (design)

## Summary

Evolve the Image Impact ("Estimating Imaging Impact") panel:

1. **Per-log imaging settings** — by default, the two inputs (imaging scale, seeing
   FWHM) are remembered **per guide log**, durable by content hash (same mechanism as
   the Primary period). Opening a log restores its values; a different log has its own.
2. **"Remember settings" checkbox** — a global, app-wide flag. When checked, the panel
   uses and writes **one shared global value for all logs across sessions**; checking it
   copies the current values to the global. When unchecked, it's per-log again
   (per-log records preserved). A never-seen log seeds from the global values.
3. **Decimal-friendly inputs** — accept `.8`, `1.`, etc. (no leading 0 required).
4. **Label rename** — "Estimated Seeing" → **"Seeing conditions (FWHM)"**.
5. **Imaging-scale label is a link** → opens
   `https://astronomy.tools/calculators/field_of_view/` in a new tab.
6. **Interpretation tooltips** on the two ellipses, built from the prototype's phrases.

Scope: the Image Impact panel + per-log storage plumbing. Nothing else changes.

## 1–2. Storage model

### Per-log store (mirrors the Primary-period feature)

- `web/src/storage/imagingSettings.ts` — idb-keyval, prefix `imaging:`. Record:
  ```ts
  interface ImagingSettingsRecord { key: string; imagingScale: number; seeingFwhm: number; updatedAt: number; }
  ```
  `getImagingSettings(key)`, `putImagingSettings({key, imagingScale, seeingFwhm})`,
  `deleteImagingSettings(key)`, `_allImagingSettingsKeys()`.
- `web/src/state/imagingSettingsStore.ts` — `{ hash, record }` + `loadForLog(hash)`
  (loads the record, ignoring a stale read if the active hash changed),
  `setForLog(hash, imagingScale, seeingFwhm)` (writes the full record), `clear()`.
- `web/src/state/logStore.ts` — call `useImagingSettingsStore.getState().loadForLog(hash)`
  in `loadFromText` (next to the primaryPeriod load) and `.clear()` in `clear`.

### Global values + checkbox (viewStore, localStorage)

- Keep `imagingScale` / `seeingFwhm` as the **global** values (also the new-log seed).
- Add `rememberImaging: boolean` (default `false`) + `setRememberImaging`; persist it.

### Effective value resolution (in the component)

```
effectiveScale = rememberImaging ? globalScale : (perLog?.imagingScale ?? globalScale)
effectiveFwhm  = rememberImaging ? globalFwhm  : (perLog?.seeingFwhm   ?? globalFwhm)
```

Editing an input:
- `rememberImaging` ON → `setImagingScale` / `setSeeingFwhm` (global).
- OFF → `imagingSettingsStore.setForLog(hash, scale, fwhm)` (writes both fields for the
  current log; the un-edited field uses its current effective value).

Checkbox toggle:
- Check ON → copy current effective values into the global (`setImagingScale(eff)` +
  `setSeeingFwhm(eff)`), then `setRememberImaging(true)`.
- Uncheck → `setRememberImaging(false)`. Per-log records are not touched.

## 3. Decimal-friendly inputs

A small `DecimalInput` (text input, `inputMode="decimal"`) holds the raw string locally
and calls `onChange(number)` only when it parses:

```tsx
const [text, setText] = useState(() => String(value));
useEffect(() => { if (parseFloat(text) !== value) setText(String(value)); }, [value]);
onChange={(e) => {
  const t = e.target.value;
  if (!/^\d*\.?\d*$/.test(t)) return;     // digits + at most one dot
  setText(t);
  const n = parseFloat(t);
  if (Number.isFinite(n)) onChange(n);    // "", "." -> NaN -> no update
}}
```

`^\d*\.?\d*$` accepts `.8`, `1.`, `0.8`, `12` — no leading 0 required. The effect re-syncs
on external value changes (log switch) without clobbering an in-progress entry that
already equals the value.

## 4–5. Labels

- Seeing label text → "Seeing conditions (FWHM)" (`imageImpact.estimatedSeeing` value).
- Imaging-scale label → `<a href="https://astronomy.tools/calculators/field_of_view/"
  target="_blank" rel="noopener noreferrer">` with an `↗` affordance and a title tooltip;
  styled as a sky-blue link. (No longer a plain `<label>` caption.)

## 6. Interpretation tooltips

Add to `computeImageImpact`'s result:
- `guidingOnlyEccentricity = safeSqrt(1 - (minor/major)^2)`.

Pure helpers in `imageImpact.ts` (testable):
- `elongationRating(ecc): 'low' | 'moderate' | 'high'` — `<0.25 low`, `<0.45 moderate`,
  else `high` (prototype thresholds).
- `samplingRelation(guideScale, imagingScale): { relation: 'same' | 'coarser' | 'finer'; ratio: number }`
  — `|g−i|<0.001 → same (ratio 1)`; `g>i → coarser (g/i)`; else `finer (i/g)`.

The component builds two `title` strings (RA / orient picked from `dominantAxis`; guide
scale = the section's `session.pixelScale`):

- **Guiding-error ellipse**: `interpGuide` + `disclaimer`.
- **Final-star ellipse**: `interpFinal{Preset|Custom}` + `sampling{Coarser|Finer|Same}` +
  `disclaimer`.

### i18n (stats.json, 6 locales) — new/changed `imageImpact` keys

- `estimatedSeeing` (value change): "Seeing conditions (FWHM)"
- `remember`: "Remember settings"
- `rememberTooltip`: "Apply these to every log; otherwise they're saved per log"
- `imagingScaleLinkTitle`: "Open the image-scale / field-of-view calculator (new tab)"
- `orientHorizontal`: "horizontal" · `orientVertical`: "vertical"
- `ratingLow`: "low estimated elongation" · `ratingModerate`: "moderate estimated elongation"
  · `ratingHigh`: "high estimated elongation"
- `interpGuide`: "The guiding error is {{axis}}-dominant — estimated elongation tends
  toward the {{axis}} direction on the sky (the camera-projected {{axis}} axis, not
  necessarily {{orient}} unless the camera is aligned that way). Guiding-only
  eccentricity {{ecc}}."
- `interpFinalPreset`: "Using the {{preset}} midpoint {{fwhm}}″, the estimated final
  eccentricity is {{ecc}} — {{rating}}."
- `interpFinalCustom`: "Using a custom FWHM of {{fwhm}}″, the estimated final
  eccentricity is {{ecc}} — {{rating}}."
- `samplingCoarser`: "The guide camera is coarser than the imaging camera by {{ratio}}×,
  so the same sky error spans more pixels on the imaging camera."
- `samplingFiner`: "The guide camera is finer than the imaging camera by {{ratio}}×, so
  the same sky error spans fewer pixels on the imaging camera."
- `samplingSame`: "The guide and imaging scales are essentially the same."
- `disclaimer`: "This is an estimate. Real star eccentricity can also be affected by
  variable seeing, optical aberrations, focus, differential flexure, field rotation,
  wind, sampling, processing, and measurement method."

All translated across the 6 locales (RA/Dec stay English), consistent with the existing
imageImpact block.

## Testing

- `imagingSettings.test.ts`: put → get round-trip; absent key → undefined; delete.
- `imagingSettingsStore.test.ts`: `loadForLog` populates `record`; `setForLog` persists +
  updates `record`; `clear` resets.
- `imageImpact.test.ts` (extend): `guidingOnlyEccentricity` on the worked example
  (0.75/0.55 → ≈0.681); `elongationRating` thresholds (0.2→low, 0.3→moderate, 0.5→high);
  `samplingRelation` (2.5 vs 0.8 → coarser ratio≈3.125; 0.8 vs 2.5 → finer; equal → same).
- Browser: per-log values persist per log and don't bleed across logs; "Remember
  settings" pins one value for all logs; reload persists records + checkbox; `.8` entry
  works; imaging-scale link opens the calculator; the two tooltips show the interpretation.

## Out of scope

- Localizing beyond the 6 existing locales; any change to the ellipse geometry, the
  Aspect Ratio cell, or other panels. The est.-eccentricity caption stays hidden (PR #89)
  — eccentricity now appears only inside the interpretation tooltips.
