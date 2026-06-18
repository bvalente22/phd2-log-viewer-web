# Polar Alignment Accuracy — Effective HA + Whole-Log Solve — Design Spec

- **Date:** 2026-06-17
- **Status:** Approved (design); pending implementation plan
- **Scope:** Improve the accuracy of the polar-alignment **error magnitude split (Alt/Az)** and add a whole-log "All Sections" solve. The drift computation is unchanged. Builds on the shipped per-section feature (`web/src/parser/polarAlignment.ts`, `StatsGrid.tsx`, `PolarAlignmentPlot.tsx`).

## 1. Goal

Two accuracy improvements plus the UI to surface them:

- **#4 Effective hour angle** — sharpen each section's Alt/Az split by using the drift-weighted mean hour angle over the section's included frames instead of the section-start HA.
- **#5 Whole-log ("All Sections") solve** — combine guiding sections at different hour angles to solve Alt & Az *uniquely* (the single-section projection is under-determined), producing one whole-log Polar Alignment Error with a confidence rating.
- **UI** — one Polar Alignment Error area that toggles between **Section** and **All Sections** (stats + bullseye together), per the approved mockup.

Out of scope (still future): directional Alt/Az (signed quadrant, #2), adjustment guidance (#3).

## 2. #4 — Effective hour angle (per-section)

Today `computePolarAlignment` projects the total PAE onto Alt/Az using `session.hourAngleHours` (the header HA ≈ HA at the first frame) — `polarAlignment.ts:112`. Over a 20–50 min section HA advances ~0.3–0.85h, so the split is computed at the wrong instant.

**Change:** compute an **effective HA** = the mean hour angle over the section's *included* frames:

```
effectiveHaHours = hourAngleHours + (meanIncludedDtSec / 3600) * SIDEREAL_RATE
```

where `meanIncludedDtSec` is the mean `dt` (seconds since section start) over the included frames used for the drift, and `SIDEREAL_RATE = 1.0027379` (HA advances at the sidereal rate). Use `effectiveHaHours` in the existing projection (`azSens = |cos|`, `altSens = |sin|`, trust thresholds). The **total PAE is unchanged** (it doesn't depend on HA); only the Alt/Az split and the trust flags change. Concrete effect (seg 10): Az contribution ~0.04′ → ~0.39′.

When `hourAngleHours` is null (older logs), Alt/Az stay null as today. Expose `effectiveHaHours` on the `PolarAlignment` result so the UI tooltip can document it.

**Tooltip (documents the method):** the bullseye / Alt-Az tooltip states that the split uses the section's mean (drift-weighted) hour angle, e.g. *"Alt/Az split uses this section's mean hour angle (≈ {{ha}}h), advanced at the sidereal rate over the included frames."* (Narrow-wrapped — see §6.)

## 3. #5 — Whole-log ("All Sections") solve

New pure function `computeGlobalPolarAlignment(log: GuideLog, masks?): GlobalPolarAlignment` over the log's guiding sessions. Computed once per log (memoized), independent of the selected section.

### 3.1 Section qualification
Include a guiding section when: its per-section PAE is determinable (≥2 included frames, declination not extreme) **and** it has at least `MIN_GLOBAL_FRAMES = 30` included frames (skip tiny/noisy sections). Use each section's effective HA (§2), signed Dec drift, pixel scale, declination, and pier side.

### 3.2 Linearized least-squares model
For each qualifying section *i*, the signed effective error is
```
e_i = PAE_CONSTANT * (driftDecPxMin_i * pixelScale_i) / cos(dec_i)        // signed (cos dec > 0)
```
The misalignment (azimuth A, altitude E, both signed arcmin) projects as
```
e_i = A * cos(H_i) + E * sin(H_i)        // H_i = effective HA in radians (= hours * 15 * π/180)
```
**Pier-side normalization:** a meridian flip inverts the camera's Dec axis relative to the sky, flipping the measured `driftDec` sign. Choose a reference pier (the first qualifying section's `pierSide`); negate `e_i` for sections whose `pierSide` differs from the reference. (Sections with null pier side are assumed to match the reference.)

Solve `[A, E]` by least squares over the qualifying sections via the 2×2 normal equations:
```
M = [[Σcos²H, ΣcosH·sinH], [ΣcosH·sinH, Σsin²H]],   b = [Σ e·cosH, Σ e·sinH]
[A, E] = M⁻¹ b
globalTotalArcMin = hypot(A, E);  globalAzArcMin = |A|;  globalAltArcMin = |E|
```
(Signed A, E are retained internally — usable by the future directional phase — but the UI shows magnitudes, consistent with the per-section v1.)

### 3.3 Confidence (High / Medium / Low / —)
Two signals: **conditioning** (how well the sections' hour angles separate the axes) and **residual** (how well the model fits).
- `haSpreadHours = max(H_i) − min(H_i)` over qualifying sections.
- `det(M)` (normalized by section count) — near 0 when sections cluster at one HA (axes inseparable).
- `residualRms = sqrt(mean((e_i − (A·cosH_i + E·sinH_i))²))`; `relResidual = residualRms / max(globalTotalArcMin, 0.5)`.

Rating (thresholds are constants, tunable):
- **— (Insufficient):** fewer than 2 qualifying sections, or `haSpreadHours < 1.0` (singular — can't separate Alt/Az). Show "—"; no global dot.
- **High:** `haSpreadHours ≥ 3.0` and `relResidual < 0.25`.
- **Medium:** `haSpreadHours ≥ 1.5` and `relResidual < 0.5`.
- **Low:** otherwise (a number is produced but conditioning/residual is marginal — possible mid-log re-align or noise).

`GlobalPolarAlignment` shape: `{ totalArcMin, altArcMin, azArcMin, confidence: 'high'|'medium'|'low'|'insufficient', sectionCount, haSpreadHours, relResidual }`.

## 4. UI — single toggling Polar Alignment Error area

The existing footer PA area becomes **one toggling unit** (stats + bullseye). A small view state (`paView: 'section' | 'all'`, default `'section'`) lives as local component state in the PA UI. Clicking the area header **or** the bullseye toggles it. The header shows which mode is active: **Polar Alignment Error · Section** ⟷ **· All Sections** with a `⟳` affordance.

- **Section mode** (default): Error badge (stoplight) · Alt · Az (with "!" trust marker) · a **Drift** line (RA/Dec) · the section bullseye (per-axis "!" badges, magnitude dot). Uses the effective-HA split (§2).
- **All Sections mode:** Error badge · Alt · Az (no "!") · a **Confidence** line — **High / Medium / Low** (or **—**) with `· N sections`, replacing the Drift line · the all-sections bullseye (no "!" badges; dot at the solved magnitude). When confidence is "—" (insufficient), show "—" for the values and no dot, with a tooltip explaining why.

The bullseye component gains a `mode` and the relevant data; the stoplight band colors the badge in both modes via `polarAlignmentBand`.

## 5. Confidence wording + tooltip
- Label: **Confidence**; values **High / Medium / Low / —**.
- Hover tooltip (narrow, §6) gives the basis, e.g. *"High confidence: 5 sections span 5.0h of hour angle with a low residual, so Alt and Az are well separated."* / for Low: *"Low confidence: sections span only 1.3h of hour angle (or a large residual) — Alt/Az are weakly separated; a mid-session re-align would also cause this."* / for —: *"Not enough sections at different hour angles to solve Alt vs Az for the whole log."*

## 6. Tooltips — narrow-wrap everywhere (now and future)
**Project rule:** native `title` tooltips must be wrapped narrow-and-tall, matching the Image Impact tooltips. ImageImpact.tsx already has a `wrap(text, max=52)` helper that inserts newlines. **Extract it to a shared util** (e.g. `web/src/i18n/format.ts` → `wrapTip(text, max=44)`) and use it for **all** Polar Alignment tooltips — the new effective-HA / confidence tooltips **and** the existing ones that are currently too wide (the per-axis "!" `pa.altLowConf`/`pa.azLowConf` and the plot `pa.tooltip`). Target width ≈ 44 chars/line (a touch narrower than ImageImpact's 52, per the feedback that the current bullseye tooltip is too wide).

## 7. Edge cases
- Older logs without hour angle: effective HA null → per-section Alt/Az null (as today); such sections are skipped by the global solve (no HA). If too few remain → confidence "—".
- Declination near ±90°: section already non-determinable → skipped.
- A log with one qualifying guiding section: confidence "—" (insufficient — can't separate Alt/Az from one section); All Sections shows "—" for the values and no dot (consistent with §3.3). The user reads the per-section result in Section mode.
- Pier-side null on some sections: assume reference pier (documented limitation; validate against a meridian-flip log when available).
- Memoization: recompute global only when the log (or masks) change.

## 8. i18n
New `stats` keys: `rows.polarAlignSection` / `rows.polarAlignAll` (or a `mode` label), `pa.confidence`, `pa.confHigh/Medium/Low/Insufficient` (the words), `pa.confTooltipHigh/Medium/Low/Insufficient`, `pa.effectiveHaTooltip`. Mirror across all 6 locales; PHD2 jargon (RA/Dec/Alt/Az/HA) stays English. Reuse existing `pa.altLowConf`/`pa.azLowConf` (now wrapped).

## 9. Testing (Vitest; sample log gitignored → synthetic + documented anchors)
- `polarAlignment.test.ts`: effective HA shifts the Alt/Az split for a section with a non-trivial duration (total PAE unchanged); null HA still yields null Alt/Az.
- `globalPolarAlignment.test.ts` (new): synthetic multi-section log with a known (A, E) and varied H_i recovers A, E by least squares; pier-side flip is normalized (flipped section doesn't break the solve); confidence = "—" when sections share one HA; "High" with wide spread + clean data; section-qualification (frame threshold) filters tiny sections.
- `wrapTip` util test (wrapping behavior) if extracted.
- Manual anchor (sample log): per-section seg 10 Az ≈ 0.39′ (effective HA); All Sections produces a plausible total with "High"/"Medium" confidence over the ~5h span. Documented for manual check.
- No component render tests (no RTL): verify toggle/labels via tsc + manual.
- Gate: `tsc --noEmit` + `vitest run` clean (run from the `G:` drive per the NAS note).

## 10. Out of scope
Directional/signed Alt/Az and the dot quadrant (#2); adjustment guidance (#3); cross-night aggregation; auto-detection of mid-log re-alignments beyond the confidence flag.
