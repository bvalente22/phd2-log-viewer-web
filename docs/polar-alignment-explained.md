# Polar Alignment Calculation — Developer Explainer

This document describes the as-built polar-alignment calculation on the
`feat/pa-accuracy` branch. It covers the per-section computation, the whole-log
("All Sections") solve, how each compares to the C++ desktop `phdlogview` app,
and an honest accuracy assessment for both.

Source files: `web/src/parser/polarAlignment.ts`,
`web/src/parser/globalPolarAlignment.ts`.

---

## 1. Per-section polar alignment

### 1.1 Included-frame set

Every frame in the guiding section is evaluated against three independent gates,
all of which must pass for the frame to be included in drift calculations.

```
included(i) = entries[i].included                 // not manually excluded
           && starWasFound(entries[i].err)         // err ∈ {0, 1}
           && !(mask && mask[i] === 1)             // optional caller-supplied mask
           && !settle[i]                           // not inside an API settling window
```

The settling mask (`settlingMask()`) marks frames from `Settling started` through
(not including) `Settling complete` / `Settling failed`, matching
`phdlogview`'s `ExcludeSettlingByAPI` default. Post-dither frames are **not**
excluded by default — see Section 3 for the settling-policy comparison.

### 1.2 RA drift — algebraic endpoint with corrections backed out

RA drift measures how fast the star drifts in the RA axis without any guiding
correction applied. The corrected guide residuals (`raraw`) obscure the
underlying polar-alignment drift, so applied RA corrections are subtracted:

```
driftRa_pps = (raraw[last] − raraw[first] − Σ raguide[included, radur≠0])
              / (dt[last] − dt[first])
```

`first` and `last` are the first and last included frames. Only frames where
`radur ≠ 0` (i.e., a correction pulse was actually sent) contribute to the
correction sum. The result is in pixels/second; multiply by 60 for px/min.

### 1.3 Dec drift — cumulative uncorrected slope with skip-gaps rule

PHD2 almost never sends Dec corrections during a guiding session (unless Dec
backlash compensation is active), so the residual `decraw` values do reflect the
real polar drift. However, dithers and settling gaps shift the lock position,
producing spurious position jumps. The skip-gaps rule prevents those jumps from
contaminating the slope.

Algorithm:

1. Seed the fit with `(dt[first], 0)`.
2. Walk included frames in order. At each consecutive pair `(prev, curr)`:
   - **Gate 1 — adjacency:** the two frames must be adjacent in the included set
     with no excluded/settling frame between them (`curr === prevIdx + 1`).
   - **Gate 2 — prev un-pulsed:** `prev` must have had `decdur === 0` (no Dec
     correction sent on that frame).
   - If both gates pass: accumulate `yAccum += decraw[curr] − decraw[prev]` and
     add `(dt[curr], yAccum)` to the regression dataset.
3. The slope of a least-squares linear fit over the dataset = `driftDec_pps`.

The adjacency gate is the skip-gaps rule: it ensures the reconstructed
cumulative signal only advances through real stellar motion, never across gaps
where the lock position has moved.

### 1.4 Total polar alignment error (PAE)

```
PAE_CONSTANT = 3.8197   // Frank Barrett / celestialwonders relation

paeTotalArcMin = PAE_CONSTANT × |driftDecPxMin| × pixelScale / cos(declination)
```

`pixelScale` is in arcsec/px; `declination` in radians. This formula is
hour-angle-independent — it measures the total misalignment magnitude from the
celestial pole, regardless of where in the sky you are pointing.

The result is marked `paeDeterminable = false` and is zeroed if fewer than two
included frames are available or if `|cos(declination)| ≤ 1e-6` (pointing too
close to a celestial pole).

### 1.5 Effective (drift-weighted mean) hour angle

The section header records the hour angle at the first frame. Over a 20–50 min
guiding section the true HA advances by 0.3–0.85 h at the sidereal rate, so
using the start HA would misplace the Alt/Az projection. The effective HA is
the mean HA over the included frames:

```
SIDEREAL_RATE = 1.0027379    // HA hours per solar hour

effectiveHaHours = hourAngleHours + (meanIncludedDtSec / 3600) × SIDEREAL_RATE
```

where `meanIncludedDtSec` is the mean `dt` (seconds since section start) over
all included frames. When `hourAngleHours` is null (older log format), the
effective HA stays null and the Alt/Az split is suppressed.

### 1.6 Alt/Az split — min-norm hour-angle projection

One section provides one equation (the Dec-drift scalar) for two unknowns (Alt
error, Az error). The minimum-norm solution projects the total PAE onto the two
axes according to the hour angle:

```
H_rad = effectiveHaHours × 15° × (π / 180)

azSens  = |cos(H_rad)|           // sensitivity of Dec drift to Az error
altSens = |sin(H_rad)|           // sensitivity of Dec drift to Alt error

azArcMin  = paeTotalArcMin × azSens
altArcMin = paeTotalArcMin × altSens
```

Note: `√(azArcMin² + altArcMin²) = paeTotalArcMin` only at H = 45° / 135°.
In general the min-norm split is a projection, not a Pythagorean decomposition.

**Trust flags:**

```
TRUST_THRESHOLD = 0.30

azTrust  = azSens  >= TRUST_THRESHOLD
altTrust = altSens >= TRUST_THRESHOLD
```

A component whose sensitivity is below 0.30 is essentially unobservable from
this section's Dec drift — the "!" flag appears in the UI for that axis.
Both axes may be flagged simultaneously (near H = 0° or H = ±90°).

---

## 2. Whole-log ("All Sections") polar alignment

Implemented in `computeGlobalPolarAlignment()` (`globalPolarAlignment.ts`).

### 2.1 Section qualification

A guiding section qualifies for the global solve when all of the following hold:

- `pa.paeDeterminable === true` (at least 2 included frames, declination not extreme)
- `pa.includedCount >= MIN_GLOBAL_FRAMES` (= 30, filters tiny / noisy sections)
- `pa.effectiveHaHours !== null` (older logs without an HA header are excluded)
- `|cos(declination)| > 1e-6`

The signed effective error for each qualifying section is:

```
e_i = PAE_CONSTANT × (driftDecPxMin_i × pixelScale_i) / cos(dec_i)   // signed arcmin
```

The sign carries the direction of the Dec drift, which is needed by the linear
model.

### 2.2 Pier-side normalization

A meridian flip inverts the camera's Dec axis relative to the sky, which flips
the sign of the measured `driftDec`. To keep all `e_i` in a common sign
convention, sections whose `pierSide` differs from the first qualifying
section's `pierSide` have their `e_i` negated. Sections with a null `pierSide`
are assumed to match the reference pier.

### 2.3 Least-squares solve

The physical model: the Dec-drift error at hour angle H is the projection of
the misalignment vector `(A, E)` (azimuth, altitude errors in arcmin, signed)
onto the hour-angle direction:

```
e_i = A × cos(H_i) + E × sin(H_i)         where H_i = effectiveHaHours × 15° × (π/180)
```

Collecting N qualifying sections gives an overdetermined system. The normal
equations (2×2) are:

```
M = [[ Σcos²H,    ΣcosH·sinH ],
     [ ΣcosH·sinH, Σsin²H    ]]

b = [ Σ(e·cosH),  Σ(e·sinH) ]

[A, E] = M⁻¹ b
```

The solve is skipped and confidence is set to `'insufficient'` when:

- Fewer than 2 qualifying sections
- `haSpreadHours < 1.0 h` (sections cluster near one hour angle — axes are not
  separable, `det(M) ≈ 0`)
- `|det(M)| < 1e-9`

Outputs exposed to the UI:

```
totalArcMin = hypot(A, E)
azArcMin    = |A|
altArcMin   = |E|
```

Signed A and E are retained internally (available for a future directional
phase) but the UI currently shows magnitudes only, consistent with the
per-section display.

### 2.4 Confidence rating

Two signals rate the quality of the solve:

```
haSpreadHours = max(H_i in hours) − min(H_i in hours)

residualRms  = sqrt( mean( (e_i − (A·cosH_i + E·sinH_i))² ) )
relResidual  = residualRms / max(totalArcMin, 0.5)
```

| Confidence | Condition |
|---|---|
| **High** | `haSpreadHours >= 3.0` and `relResidual < 0.25` |
| **Medium** | `haSpreadHours >= 1.5` and `relResidual < 0.5` |
| **Low** | Otherwise (result is produced but conditioning or fit is marginal) |
| **— (Insufficient)** | Fewer than 2 qualifying sections, or HA spread < 1 h |

A large `relResidual` typically indicates a mid-session polar re-align (the
alignment changed between sections) or a noisy section that qualified on frame
count but has high scatter. A small spread means Alt and Az are not well
separated by the available data.

---

## 3. Comparison to the C++ desktop `phdlogview`

### 3.1 What the web app reproduces

The web app reproduces `phdlogview`'s `RA Drift`, `Dec Drift`, and
`Polar Alignment Error` for each guiding section. Validation against sample log
`PHD2_GuideLog_2026-06-09_210610.txt` (pixel scale 5.04″/px, Dec 56.5°):

| Segment | C++ RA drift | Web RA drift | C++ Dec drift | Web Dec drift | C++ PAE | Web PAE |
|---|---|---|---|---|---|---|
| 8  | −0.22″/min | −0.22″/min (exact) | −0.57″/min | −0.58″/min | 3.9′ | 4.0′ |
| 10 | −0.08″/min | −0.08″/min (exact) | −0.44″/min | −0.45″/min | 3.1′ | 3.1′ |
| 15 | −0.02″/min | −0.02″/min (exact) | −0.17″/min | −0.17″/min | 1.2′ | 1.2′ |

RA drift matches exactly. Dec drift is within ≈ ±0.01″/min. PAE is within
≈ 0.1′ on all three segments.

The algorithms used:

- **RA drift:** algebraic endpoint with corrections backed out (Section 1.2) —
  this is the same intent as the desktop; the web implementation uses exact
  pixel-space arithmetic.
- **Dec drift:** cumulative uncorrected slope with skip-gaps (Section 1.3) —
  the desktop binary also uses skip-gaps. (The desktop C++ source text appears
  to accumulate across gaps, which is a latent source bug that the binary does
  not exhibit; the web implementation matches the binary behavior, which is also
  physically correct.)
- **PAE formula:** `3.8197 × |driftDecPxMin| × pixelScale / cos(dec)` —
  identical to the desktop.

### 3.2 What the web app adds (desktop has none of these)

| Feature | Web app | Desktop `phdlogview` |
|---|---|---|
| Alt/Az split | Yes — min-norm hour-angle projection (Section 1.6) | No |
| Effective (mean) HA | Yes — sharpens the split over long sections (Section 1.5) | No |
| Whole-log least-squares solve | Yes — Section 2 | No |
| Confidence rating | Yes — Section 2.4 | No |

### 3.3 Settling policy

Both apps default to **API-settling-window exclusion only**: frames between
`Settling started` and `Settling complete` / `Settling failed` are excluded.
Post-dither frames (outside an explicit settling window) are included by default
in both.

An earlier discrepancy was traced to the web app additionally excluding five
frames after each dither, giving −0.21″/min vs the desktop's −0.17″/min on
segment 15. The default was corrected to match the desktop. An optional stricter
mode ("Exclude Frames Settling + Dithers") that excludes five extra frames after
each dither is available via the guiding chart right-click context menu but is
not the default.

---

## 4. Accuracy assessment

### 4.1 Per-section

**Total PAE** is accurate. It is HA-independent and validated to match the
desktop within 0.1′.

**Alt/Az split** is a min-norm single-section estimate subject to a fundamental
observability constraint: one section provides one scalar measurement for two
unknowns. The effective HA corrects for HA drift during the section (a
meaningful improvement for long sections), but it does not remove the
single-section ambiguity. Concretely:

- Near the meridian (H ≈ 0°): `cos(H) ≈ 1`, `sin(H) ≈ 0` → Az is well
  measured, Alt is essentially unobservable → Alt gets "!".
- Near HA = ±6 h (near the horizon): `cos(H) ≈ 0`, `sin(H) ≈ 1` → Alt is
  well measured, Az is essentially unobservable → Az gets "!".
- At H ≈ ±3 h (45°): both components are partially observable; neither is
  flagged. The split is still under-determined (one equation, two unknowns) but
  the min-norm projection is less misleading here.

The "!" flag (`TRUST_THRESHOLD = 0.30`) reliably warns when a component is
nearly invisible at the current hour angle. **Do not report the "!" component
as a reliable polar-alignment axis correction.** Total PAE is always reliable;
use the split only as a rough decomposition when neither axis is flagged.

### 4.2 Whole-log ("All Sections")

**Resolves the Alt/Az ambiguity** by combining sections at different hour
angles. Each section contributes one equation; the 2×2 least-squares system has
a unique solution when the hour angles span enough of the sky.

Accuracy depends on two factors, both surfaced via the Confidence rating:

1. **Hour-angle spread.** Sections near the same HA contribute nearly identical
   equations — the system is poorly conditioned (det(M) small). A spread of
   ≥ 3 h gives High confidence; < 1 h gives "—" (insufficient to separate
   Alt/Az at all).

2. **Fit residual.** A large residual means the linear model `e_i = A cosH +
   E sinH` does not fit the data well. Common causes:
   - The mount was re-aligned mid-session (alignment changed between sections).
   - One or more sections have high drift scatter (settled poorly, clouds, etc.).
   - Pier-side data is missing on some sections (null pier side assumed to match
     reference, which may be wrong after a flip).

   A Low-confidence number is produced but should be treated with scepticism; a
   "—" result means no number is produced at all.

**Assumptions:**

- A single, constant polar alignment throughout the log. Violated by mid-session
  re-aligns. The confidence rating's residual term is the primary signal for
  detecting this.
- Pier-side data is available or all sections share the same pier side. A
  meridian flip with missing `pierSide` fields can silently invert the sign of
  `e_i` for the flipped sections, corrupting the solve.
- The pixel scale and declination are constant within each section (they are
  taken from the section header).

---

## 5. How to read the UI

### 5.1 Polar Alignment Error area (guiding stats footer)

The **Polar Alignment Error** area is a toggling unit in the **Stats grid**
(guiding stats footer). The header label toggles between:

- **Section** — shows the per-section result for the currently selected guiding
  section.
- **All Sections** — shows the whole-log result combining all qualifying sections.

Clicking the area header or the bullseye graphic cycles between the two modes.

### 5.2 Section mode

| Field | Meaning |
|---|---|
| Error badge (stoplight) | Total PAE in arcmin; green ≤ 2′, yellow 2–5′, red > 5′ |
| Alt / Az | Per-axis min-norm projection; "!" when `altTrust` / `azTrust` is false |
| Drift line | RA drift · Dec drift in ″/min (and px/min in px-scale mode) |

The bullseye graphic places a dot at distance = total PAE from center, angled
toward the dominant axis (based on the Alt/Az split). "!" badges appear on the
relevant axis when trust is low.

### 5.3 All Sections mode

| Field | Meaning |
|---|---|
| Error badge | Total PAE from the global least-squares solve |
| Alt / Az | Global `altArcMin` / `azArcMin`; no "!" flags (trust is embedded in the Confidence rating) |
| Confidence | **High / Medium / Low / —** with the section count (N sections) |

When Confidence is "—" (insufficient), all numeric fields show "—" and the
bullseye has no dot.

Hover tooltips on the Confidence field give the basis (HA spread, residual, or
reason for insufficient).

### 5.4 "!" trust flag

A "!" next to Alt or Az in Section mode means the current section's effective
hour angle makes that axis nearly unobservable from Dec drift. The total PAE
(shown in the badge) is unaffected and reliable; the split for the flagged axis
is not.

---

## 6. Key constants

| Constant | Value | Purpose |
|---|---|---|
| `PAE_CONSTANT` | 3.8197 | Barrett / celestialwonders formula coefficient |
| `TRUST_THRESHOLD` | 0.30 | Minimum `\|cos H\|` / `\|sin H\|` for a reliable axis split |
| `SIDEREAL_RATE` | 1.0027379 h/h | HA advance rate (sidereal hours per solar hour) |
| `MIN_GLOBAL_FRAMES` | 30 | Minimum included frames for a section to qualify for the global solve |
| HA spread threshold (High) | 3.0 h | `haSpreadHours` for High confidence |
| HA spread threshold (Medium) | 1.5 h | `haSpreadHours` for Medium confidence |
| `relResidual` threshold (High) | 0.25 | Relative residual for High confidence |
| `relResidual` threshold (Medium) | 0.50 | Relative residual for Medium confidence |
