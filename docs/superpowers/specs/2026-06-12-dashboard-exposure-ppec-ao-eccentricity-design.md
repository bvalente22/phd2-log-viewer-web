# Guiding dashboard: exposure, PPEC gains, AO unit + StatsGrid eccentricity

Date: 2026-06-12
Status: Approved (design)

## Summary

Four additive enhancements to the guiding-section views. Nothing existing changes
behavior; every item is a new tile/field that appears only when its source data is
present.

1. **Exposure** tile on the guiding dashboard (the "Pier side …" strip).
2. **PPEC (Predictive PEC)** — show both gains (Control gain + Prediction gain) on the
   RA guide-algorithm tile.
3. **AO unit** — when an adaptive-optics unit is present in the header, add an "AO Unit"
   tile valued `Present`.
4. **Eccentricity** — a color-coded badge in the StatsGrid **Total** row quantifying how
   elongated the RA/Dec guiding scatter is.

Scope: the **guiding** dashboard ([GuidingDashboard.tsx](../../../web/src/components/GuidingDashboard.tsx))
and the StatsGrid ([StatsGrid.tsx](../../../web/src/components/StatsGrid.tsx)). The calibration
dashboard is intentionally untouched.

## Source data (PHD2 header lines)

All header lines for a guiding section are captured verbatim in `session.hdr`
(see [parseLog.ts](../../../web/src/parser/parseLog.ts) `s.hdr.push(ln)`), so
`parseGuideHeader(hdr)` already has access to everything below.

- **Exposure**: `Exposure = 2000 ms` (single line, value in ms).
- **PPEC** (two lines): the RA algorithm line carries the control gain, the prediction
  gain is on its **own** following line:
  ```
  X guide algorithm = Predictive PEC, Control gain = 0.800
  Prediction gain = 0.800
  ```
  PPEC is an RA-axis algorithm. Older logs may carry only `Control gain` (no
  `Prediction gain` line) — handle its absence gracefully.
- **AO**: a line beginning `AO = …` (constant `AO_KEY` in
  [tokens.ts](../../../web/src/parser/tokens.ts); the parser already sets
  `session.ao.isValid` from it). No real AO sample log is available, so we only detect
  presence; we do not parse AO-specific fields beyond an optional device name for the
  tooltip.

## 1. Eccentricity

### Formula

Symmetric, order-independent, always real, in `[0, 1]`:

```
lo  = min(rmsRa, rmsDec)
hi  = max(rmsRa, rmsDec)
ecc = hi > 0 ? sqrt(1 - (lo*lo) / (hi*hi)) : 0
```

- RA ≈ Dec → `ecc ≈ 0.00` (round / balanced guiding).
- Axes diverge → `ecc → 1` (elongated).
- It's a ratio of the two per-axis RMS values, so it is **scale-independent** — the same
  number in arc-seconds or pixels. Computed once from the pixel-space `rmsRa`/`rmsDec`.
- Worked example: `rmsRa = 0.625`, `rmsDec = 0.998` → `ecc = sqrt(1 - 0.625²/0.998²) = 0.78`.
- Guard: `hi <= 0` (no motion / empty selection) → `0`.

`rmsRa`/`rmsDec` here are RMS **about the mean** (the existing `calcStats` values).

### Where it lives

- Add `ecc: number` to `SessionStats` and compute it in `calcStats`
  ([stats.ts](../../../web/src/parser/stats.ts)), next to `rmsTotal`.
- A small pure presentation helper classifies the value into a color band:
  ```
  eccBand(e): 'green' | 'yellow' | 'red'
    e <= 0.50            -> 'green'
    e <= 0.65            -> 'yellow'
    else (e >= 0.66)     -> 'red'
  ```
  Thresholds are evaluated on the value **rounded to 2 decimals** (what the user sees), so
  e.g. a displayed `0.50` is green and `0.66` is red. Exported for unit testing.

### Display

- A color-coded badge added to the **Total** row of the StatsGrid, immediately after the
  `RMS` cell. Reads `Ecc 0.78` (label `Ecc`, value to 2 decimals via `fmtNumber(e, 2)`).
- Background = band color; text contrast picked for readability:
  - green → background `emerald-600`, text white
  - yellow → background `amber-400`, text dark slate (`slate-900`)
  - red → background `rose-600`, text white
- Tooltip: explains the metric and shows the RA/Dec RMS that produced it, e.g.
  "Eccentricity 0.78 — elongation of the RA/Dec scatter (0 = round, 1 = a line). RA 0.625 / Dec 0.998".
- Clickable-to-copy like the other cells (copies the numeric value).

## 2. PPEC gains (RA algorithm tile)

`parseGuideHeader` post-processes the parsed RA `AlgoInfo` when `name === 'Predictive PEC'`:

- `ctrl` = `Control gain = <num>` from the X-algo line.
- `pred` = `Prediction gain = <num>` from the first matching `hdr` line.
- Set `ra.param` to `ctrl 0.8 · pred 0.8` (each present part joined by ` · `, numbers
  tidied with the existing `tidyNum`). If only one is present, show only that one. If
  neither parses, leave `ra.param` as whatever the generic parser produced.

The dashboard's existing `algoSub` then renders `Predictive PEC · ctrl 0.8 · pred 0.8`.
`ctrl`/`pred` are code-side English labels, consistent with the existing `agg` / `min` /
`hyst` / `slope wt` labels in [guideHeader.ts](../../../web/src/parser/guideHeader.ts).

Non-PPEC algorithms are unaffected.

## 3. Exposure tile

- Extend `GuideHeaderInfo` with `exposure: string | null`.
- Parse `Exposure = (\d+) ms` from `hdr`; store the raw ms string.
- Tile: caption `Exposure`, value in **seconds** for readability (e.g. `2 s`,
  `1.5 s` — ms/1000, trailing zeros trimmed via `tidyNum`). The tooltip carries the
  raw `… ms`.
- Placed right after the Pier side tile.

## 4. AO unit tile

- Extend `GuideHeaderInfo` with `ao: { present: true; name: string | null } | null`.
- Detect via any `hdr` line starting with `AO = ` (mirrors `AO_KEY`). `name` = the text
  up to the first comma on that line, if any (for the tooltip only).
- Tile: caption `AO Unit`, value `Present`. The device name (if parsed) is appended to the
  tooltip. The tile is omitted entirely when no AO line exists (the common case).

## i18n

New caption keys, added across all six locales (en, es, de, fr, it, zh), following
[locales/README.md](../../../web/src/i18n/locales/README.md) — astrophotography jargon
(RA, Dec, AO) stays English; surrounding words are translated:

- `sections.json` → `dashboard.exposure` ("Exposure"), `dashboard.aoUnit` ("AO Unit"),
  `dashboard.aoPresent` ("Present").
- `stats.json` → `guide.eccentricity` ("Ecc").

The `ctrl` / `pred` PPEC sub-labels are code-side English (not i18n), matching the
existing algorithm sub-label convention.

## Testing

Unit (vitest):

- [guideHeader.test.ts](../../../web/src/parser/__tests__/guideHeader.test.ts):
  - exposure parsed from `Exposure = 2000 ms` → `"2000"` (raw ms field); absent → null.
  - PPEC: `X guide algorithm = Predictive PEC, Control gain = 0.800` + `Prediction gain = 0.800`
    → `ra.param === 'ctrl 0.8 · pred 0.8'`; with only Control gain → `'ctrl 0.8'`.
  - AO: `AO = …` line present → `ao.present === true` (+ name); absent → null.
- [stats.test.ts](../../../web/src/parser/__tests__/stats.test.ts):
  - `ecc` formula: equal axes → 0; `0.625`/`0.998` → ~`0.78`; very divergent → near 1;
    zero-motion guard → 0; order independence (swapping ra/dec gives the same value).
- `eccBand` thresholds: `0.50`→green, `0.51`/`0.65`→yellow, `0.66`/`0.80`→red.

Browser verification (per the project's chart/UI verification rule): load a sample log and
confirm the Exposure tile, the PPEC `ctrl · pred` sub on a Predictive-PEC log, and the
eccentricity badge color across at least two themes. (No AO sample exists, so the AO tile's
"present" path is exercised by a unit test + a temporary synthetic `AO = ` header line in
the browser if feasible; otherwise unit-tested only and noted.)

## Out of scope / non-goals

- Calibration dashboard changes.
- Parsing AO-specific guide parameters (no sample available; presence only).
- Any change to existing tiles, stats, or the eccentricity of the PCA scatter ellipse
  (`SessionStats.ellipse.elongation`) — that is a separate, unrelated quantity and is left
  as-is.
