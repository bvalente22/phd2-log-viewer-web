# Polar Alignment — Design Spec

- **Date:** 2026-06-17
- **Status:** Approved (design); pending implementation plan
- **Scope:** Per-section polar-alignment estimate for the web PHD2 log viewer, shown in the guiding stats footer with a target-plot graphic.

## 1. Goal

For the currently displayed **guiding section**, estimate and display:

1. **Total polar-alignment error** (arcmin), stoplight-coded.
2. The **Altitude** and **Azimuth** contributions to that error.
3. The underlying **RA / Dec drift** rates (the inputs to the calculation).

Presented as text in the guiding stats footer (a new "Polar Alignment" subtitled area) plus a **target-plot** graphic. Polar alignment error is computed **per guidelog section**. A future feature may average the error across meaningful sections — out of scope here, but the per-section computation is factored so an aggregate can consume it later.

## 2. Background

- The desktop **phdlogview** C++ app shows `RA Drift`, `Dec Drift`, and `Polar Alignment Error` on its main-window stats panel for a guiding section. This feature reproduces that, then extends it with the Alt/Az split and the graphic.
- Reference for the conversion: Frank Barrett, *Measuring Polar Axis Alignment Error* (celestialwonders.com). The total-error formula is `3.8197 · (Dec drift in ″/min) / cos(δ)`.
- **Existing web bug (to be fixed):** the current `calcStats` in `web/src/parser/stats.ts` computes drift via a plain linear regression on the *already-corrected* residuals (`raraw`/`decraw`). For a guided session this yields ≈0 (guiding suppresses the raw residual drift), so the "PAE" already shown in the Total row is meaningless for guided runs (segment 10 → PAE 0.03′). This feature **replaces** that computation with the back-out-corrections algorithm below, which fixes the existing values and feeds the new readout.

## 3. Core algorithm (validated)

Ported from phdlogview `AnalysisWin.cpp` (`DecDrift`, `RaDrift`, `PolarAlignError`) with one corrected behavior (skip-gaps, see below).

**Included frames:** a frame is included when the star was found (`err` ∈ {0,1}) **and** it is not inside an API settling window (between an `INFO: ... Settling started` and the following `Settling complete`/`Settling failed`), **and** it is not manually excluded (existing exclusion `mask`). Time `dt` is the log Time column (seconds).

- **RA drift** (px/s) — algebraic endpoint, backing out corrections:
  ```
  raDrift = (raraw_last − raraw_first − Σ raguide[included & radur≠0]) / (dt_last − dt_first)
  ```
  `*_first`/`*_last` are the first and last included frames.

- **Dec drift** (px/s) — least-squares slope of a reconstructed "uncorrected Dec" signal:
  - Seed the fit at `(dt_first, 0)`; `y_accum = 0`.
  - Walking included frames in order, accumulate `y_accum += decraw − prev_decraw` and add `(dt, y_accum)` to the fit **only when** the previous included frame was un-pulsed (`decdur == 0`) **and is adjacent** (no excluded/settling frame lies between them). This *skip-gaps* rule prevents accumulating a position delta across a dither/settling gap, where the lock position has moved and the delta is not real star motion.
  - Slope of the fit = `decDrift` (px/s).

- **Unit conversion:** `drift_*_pxmin = drift_*_pps × 60`; `drift_*_arcsecmin = drift_*_pxmin × pixelScale`.

- **Total PAE** (arcmin): `paeTotal = 3.8197 × |drift_dec_pxmin| × pixelScale / cos(declination)` (`declination` in radians).

### 3.1 Validation results

Reimplementation run against `sample data/polarAlignment/PHD2_GuideLog_2026-06-09_210610.txt` (pixel scale 5.04″/px, Dec 56.5°). Matches the C++ app to ≤0.1′ with the **skip-gaps** rule; accumulate-across-gaps does **not** match.

| Segment | C++ app (target) | This algorithm (skip-gaps) |
|---|---|---|
| 8 | RA −0.22″/min, Dec −0.57″/min, PAE 3.9′ | RA −0.22″, Dec −0.58″, PAE 4.0′ |
| 10 | RA −0.08″/min, Dec −0.44″/min, PAE 3.1′ | RA −0.08″, Dec −0.45″, PAE 3.1′ |
| 15 | RA −0.02″/min, Dec −0.17″/min, PAE 1.2′ | RA −0.02″, Dec −0.17″, PAE 1.2′ |

(The literal C++ *source* accumulates across gaps — a latent bug giving 3.2′ on seg 10 — but the shipped binary's behavior matches skip-gaps, which is also physically correct.)

## 4. Altitude / Azimuth decomposition — hour-angle projection

A single section gives one Dec-drift number = **one equation, two unknowns** (Alt error, Az error), so the split requires a modeling assumption. We use the **minimum-norm hour-angle projection**, consistent with the reference article's geometry (azimuth is best measured at the meridian, altitude at HA ±6h):

```
HA_deg = hourAngleHours × 15
Az  = paeTotal × |cos(HA_deg)|
Alt = paeTotal × |sin(HA_deg)|         →  √(Alt² + Az²) = paeTotal
```

- **Trust flags:** a component is low-confidence (essentially unobservable at this hour angle) when its sensitivity is small: `azTrust = |cos HA| ≥ 0.30`, `altTrust = |sin HA| ≥ 0.30` (threshold tunable). A low-confidence component drives the "!" badge + tooltip in the UI.
- **Hour angle source (v1):** the section-header hour angle (start of section). *Future phase: mid-section HA = start + duration/2 at sidereal rate, for long sections.*
- **Stated limitation (must appear in UI/tooltip):** this is an under-determined single-session estimate; the projection assumes the minimum misalignment consistent with the measured drift, and the "!" flags where a component cannot be reliably separated.

## 5. Data & parsing changes — `web/src/parser/`

- `GuideSession.pixelScale` (arcsec/px) and `GuideSession.declination` (radians) already exist.
- **New on `GuideSession`:** `hourAngleHours: number | null` and `pierSide: string | null`, parsed in `parseLog.ts` from the same `RA = … hr, Dec = … deg, Hour angle = … hr, Pier side = …` header line that already yields `declination`. `pierSide` is parsed now for the future directional phase; v1 does not use it for placement.
- **Settling exclusion:** `calcStats` does not currently exclude settling frames. The new computation must replicate `ExcludeSettlingByAPI` from the parsed `infos` events (start → complete/failed windows). Implementation must confirm `infos` carry usable entry indices; if not, derive windows during the stats pass.

## 6. Computation — `web/src/parser/stats.ts`

- **Replace** the current `driftRa` / `driftDec` / `paeArcMin` computation with the §3 algorithm (this corrects the existing values too).
- `SessionStats` fields:
  - Keep field names, now computed correctly via §3: `driftRa`, `driftDec` (px/min), `driftRaArcsec`, `driftDecArcsec` (″/min), and `paeArcMin` (the total PAE; no rename — its value becomes correct because `driftDec` is now correct).
  - **Add:** `altArcMin`, `azArcMin`, `altTrust: boolean`, `azTrust: boolean`, `hourAngleHours: number | null`.
- Honor the existing exclusion `mask` combined with settling exclusion.
- Factor the PA math (`computePolarAlignment(driftDecPxMin, pixelScale, declination, hourAngleHours)`) as a pure function so a future cross-section aggregate can reuse it.

## 7. UI — `web/src/components/StatsGrid.tsx` + target graphic

A 4th subtitled **"Polar Alignment"** `<Row>` rendered beneath the Dec row:

- **Line 1 — Total:** total PAE, stoplight-colored. Reuse `Band` / `BAND_CLASSES` from `web/src/components/guidingMetric.ts` via a new `polarAlignmentMetric` with `band()`: ≤2′ green, 2–5′ yellow, >5′ red.
- **Line 2 — Split:** Alt contribution · Az contribution; each shows a "!" affordance with a hover tooltip when its trust flag is false (wording explains low confidence at this hour angle).
- **Line 3 — Drift:** RA drift, Dec drift (″/min + px/min, honoring `viewStore.scaleMode`).
- **Removed:** the per-axis "drift" cells in the RA and Dec rows, and the stale "PAE" cell in the Total row (drift now lives in the PA area; total PAE in line 1).

**Target graphic (approved visual):**

- Concentric **faded** zones (no outlines): green ≤2′, yellow 2–5′, red >5′; the yellow band is a true yellow (`#facc15`), not amber.
- Faint crosshair; **Altitude** on the vertical axis, **Azimuth** on the horizontal axis (magnitude labels only in v1 — no high/low/E-W).
- **Error dot (v1 = magnitude only):** distance from center = total PAE (lands in the correct stoplight ring); angle = `atan2(Alt, Az)` so the dot leans toward the dominant axis, placed in a single quadrant. The dot represents *magnitude and split*, not correction direction.
- **"!" badge** on a low-confidence axis (per §4 trust flags), with hover tooltip; both may be flagged.
- **Placement:** rendered compact (~150px) to the right of the PA numbers, mirroring how `ImageImpact` sits beside `StatsGrid` in `web/src/pages/ViewerPage.tsx`.
- **i18n:** new keys in the `stats` namespace, mirrored across all 6 locales (en/es/de/fr/it/zh). PHD2 jargon (RA, Dec, Alt, Az, PAE) stays English per repo convention.

## 8. Edge cases

- **Missing hour angle** (older logs without the field): show total PAE only; grey out Alt/Az with a short note; no "!" badges; graphic shows the total ring with the dot centered (or omitted).
- **Declination near ±90°** (`cos δ → 0`): guard division; show "—" / a warning when `|δ|` is extreme.
- **Too few included frames** (<2) or no usable Dec data: show "—".
- **Calibration sections / non-guiding views:** no Polar Alignment area.
- **Error > 6′:** graphic clamps the dot to the red edge; the number is shown as computed.

## 9. Testing

- **Vitest** unit tests in `web/src/parser/__tests__/stats.test.ts` (and/or a new `polarAlignment.test.ts`) using **synthetic** fixtures (the real sample log is gitignored): cover back-out-corrections (RA endpoint, Dec cumulative), the skip-gaps rule across a settling gap, API settling exclusion, unit conversions, the HA projection, and trust flags. Include a hand-built dataset with a known drift slope.
- The seg 8/10/15 expected values (§3.1) are documented here for **manual** verification against the local sample file.
- A **component test** covers the PA row rendering, stoplight band classes, and the "!" badge presence/absence by trust flag.
- Gate: `cd web && npx tsc --noEmit && npx vitest run` clean before merge.

## 10. Future phases (explicitly not in v1)

- **Mid-section hour angle** for long sections.
- **Dot direction / quadrant** (too-high vs too-low, E vs W) using Dec-drift sign + pier side + hemisphere.
- **Precise adjustment direction/magnitude** ("turn the altitude bolt X").
- **Cross-section aggregate** polar-alignment error across meaningful sections.
- Multi-session 3-point (Challis/Taki) solve; latitude-based RA+Dec two-equation solve.

## 11. Out of scope

Anything in §10; changes to calibration analysis; non-guiding views.
