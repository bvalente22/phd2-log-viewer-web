# StatsGrid badge: switch metric to Aspect Ratio (eccentricity kept as a code toggle)

Date: 2026-06-12
Status: Approved (design)

## Summary

The StatsGrid Total-row badge currently shows **Guiding Eccentricity**
(`√(1 − min²/max²)`). Switch the displayed metric to **Aspect Ratio**
(`Max/Min` of the two per-axis RMS values), with new label, formula, and color
thresholds. Keep the eccentricity algorithm fully present but dormant behind a
single source-code switch so it can be re-enabled later.

Only the StatsGrid badge is affected. Nothing else changes.

## Metric definitions

Inputs are the per-axis RMS-about-the-mean values already in `SessionStats`:
`V1 = rmsRa`, `V2 = rmsDec`. Both metrics are a ratio of those, so they are
**scale-independent** (identical in arc-seconds or pixels) and order-independent.

Let `lo = min(rmsRa, rmsDec)`, `hi = max(rmsRa, rmsDec)`.

### Aspect Ratio (new active metric)

- **Compute:** `lo > 0 ? hi / lo : null`. Range `[1, ∞)`; `1.00` = round/balanced,
  higher = more elongated. `null` = N/A (no measurable motion — empty or
  fully-excluded selection, both RMS = 0).
- **Display:** 2 decimal places.
- **Color bands** (on the value rounded to 2 decimals):
  - `≤ 1.20` → green
  - `1.21 – 1.60` → yellow
  - `> 1.60` → red
- **Label:** "Aspect Ratio". **Tooltip:** "Aspect ratio {{value}} — Max/Min of the
  RA & Dec RMS (1.00 = round, higher = elongated). RA {{ra}} / Dec {{dec}}".

### Eccentricity (kept, dormant)

- **Compute:** `hi > 0 ? sqrt(1 − lo²/hi²) : null`. (Previously returned `0` for the
  no-motion case; now returns `null` for consistency with Aspect Ratio. Dormant, so
  this only matters if re-enabled.)
- **Color bands:** `≤ 0.50` green, `0.51–0.65` yellow, `≥ 0.66` red (unchanged).
- **Label:** "Guiding Eccentricity". **Tooltip:** existing `eccentricityTooltip`.

## Architecture

### New module: `web/src/components/guidingMetric.ts`

Renames and generalizes the current `web/src/components/eccBand.ts` (which is no
longer eccentricity-specific). Single source of truth for the badge metric:

```ts
export type Band = 'green' | 'yellow' | 'red';
export const BAND_CLASSES: Record<Band, string> = {
  green: 'bg-emerald-600 text-white',
  yellow: 'bg-amber-400 text-slate-900',
  red: 'bg-rose-600 text-white',
};

export interface GuidingMetric {
  labelKey: string;      // i18n key for the badge label
  tooltipKey: string;    // i18n key for the badge tooltip
  compute(rmsRa: number, rmsDec: number): number | null;  // null = N/A
  band(value: number): Band;
}

export const aspectRatioMetric: GuidingMetric = { ... };
export const eccentricityMetric: GuidingMetric = { ... };

// Source-code switch: change to `eccentricityMetric` to restore the old metric.
export const guidingMetric: GuidingMetric = aspectRatioMetric;
```

### `web/src/parser/stats.ts`

Remove the `ecc` field from `SessionStats` and its computation in `calcStats`.
The display metric is now derived in the component from `rmsRa`/`rmsDec` via
`guidingMetric`, keeping the parser layer free of presentation concerns. (`ecc` is
read only by the badge — confirmed by grep — so removal is safe.)

### `web/src/components/StatsGrid.tsx`

The badge reads from the active `guidingMetric`:

```tsx
const metric = guidingMetric;
const mv = metric.compute(s.rmsRa, s.rmsDec);
const text = mv === null ? '—' : fmt(mv, 2);
const cls = mv === null ? 'bg-slate-700 text-slate-400' : BAND_CLASSES[metric.band(mv)];
// button: neutral grey "—" when null (not clickable); otherwise colored, copy-on-click,
// title = t(metric.tooltipKey, { value: text, ra: v(s.rmsRa), dec: v(s.rmsDec) })
// label span = t(metric.labelKey)  (CSS uppercases it -> "ASPECT RATIO 1.67")
```

### i18n (all 6 locales: en, es, de, fr, it, zh)

Add to `stats.json`:
- `guide.aspectRatio` — label.
- `aspectRatioTooltip` — top-level, sibling of `eccentricityTooltip`.

Keep `guide.eccentricity` and `eccentricityTooltip` for the dormant metric.

| key | en | es | de | fr | it | zh |
|---|---|---|---|---|---|---|
| `guide.aspectRatio` | Aspect Ratio | Relación de aspecto | Seitenverhältnis | Rapport d'aspect | Rapporto d'aspetto | 纵横比 |

`aspectRatioTooltip` per locale (same `{{value}}`/`{{ra}}`/`{{dec}}` interpolation):
- en: `Aspect ratio {{value}} — Max/Min of the RA & Dec RMS (1.00 = round, higher = elongated). RA {{ra}} / Dec {{dec}}`
- es: `Relación de aspecto {{value}} — Máx/Mín del RMS de RA y Dec (1.00 = redonda, mayor = alargada). RA {{ra}} / Dec {{dec}}`
- de: `Seitenverhältnis {{value}} — Max/Min des RA- und Dec-RMS (1.00 = rund, höher = länglich). RA {{ra}} / Dec {{dec}}`
- fr: `Rapport d'aspect {{value}} — Max/Min des RMS RA et Dec (1.00 = ronde, plus élevé = allongée). RA {{ra}} / Dec {{dec}}`
- it: `Rapporto d'aspetto {{value}} — Max/Min dell'RMS di RA e Dec (1.00 = rotonda, maggiore = allungata). RA {{ra}} / Dec {{dec}}`
- zh: `纵横比 {{value}} — RA 与 Dec RMS 的最大/最小值（1.00 = 圆形，越大越拉长）。RA {{ra}} / Dec {{dec}}`

## Testing

Rename `web/src/components/__tests__/eccBand.test.ts` →
`guidingMetric.test.ts` and cover:

- `aspectRatioMetric.compute`: `(3, 5)` → `1.6667…` (≈1.67); equal `(5, 5)` → `1`;
  order independence `(5, 3) === (3, 5)`; `(0, 0)` → `null`; `(0, 4)` → `null`.
- `aspectRatioMetric.band`: `1.20`→green, `1.21`→yellow, `1.60`→yellow, `1.61`→red;
  rounding (`1.604`→1.60 yellow, `1.605`→1.61 red).
- `eccentricityMetric.compute`: `(3, 5)` → ≈`0.8`; equal → `0`; `(0,0)` → `null`.
- `eccentricityMetric.band`: existing thresholds (`0.50`→green, `0.65`→yellow,
  `0.66`→red).

Remove the two `ecc` cases from `stats.test.ts` (migrated above).

Browser verification: load a guiding log, confirm the Total-row badge reads
"ASPECT RATIO <n.nn>" with the correct color band, across at least two themes.

## Out of scope

- Any non-badge UI; the dashboard tiles; the PCA `ellipse.elongation` stat.
- A user-facing metric switcher (the toggle is source-code only, by request).
