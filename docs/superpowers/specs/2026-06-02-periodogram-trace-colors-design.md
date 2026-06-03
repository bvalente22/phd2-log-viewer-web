# Periodogram trace colors — theme-aware amber/teal

**Date:** 2026-06-02
**Status:** Approved (brainstorming, via web-UI mockups)

## Problem

The analysis-screen periodogram's residual-error and raw-RA traces are hard to
read on every theme. Causes: the colors are **hardcoded** (lime `#a3e635` /
pink `#f472b6`) so they wash out on the two white backgrounds (Paper,
Monochrome); the active line is thin (1.5px); and the counterpart trace is very
faint (opacity 0.28).

## Decision

- **Residual = Amber, Raw RA = Teal**, and **theme-aware** (chosen over
  blue/orange and green/magenta; blue and red are reserved for RA/Dec elsewhere
  so they're avoided here).
  - Dark-background themes (`default`, `high-contrast`, `night`):
    amber `#fbbf24`, teal `#2dd4bf`.
  - White-background themes (`paper`, `monochrome`):
    amber `#d97706`, teal `#0d9488` (deepened for contrast).
- **Thicker active line:** 1.5px → **2.5px**.
- **Less-faint counterpart:** opacity 0.28 → **0.5**, width 1.25px → **1.75px**.

Monochrome keeps the (deep) amber/teal rather than going grayscale — the user
reviewed it on the Monochrome background and accepted the color.

## Implementation

Colors live in the theme registry alongside the existing theme-aware trace
colors (`traceMass` / `traceSnr`), so the chart reads them from the same `tc`
object it already uses for `paper`/`grid`/`font`.

- **[themes.ts](web/src/themes.ts)**: add `fftResidual: string` and
  `fftRawRa: string` to `PlotThemeColors`, and set both in all five themes
  (bright variants on the three dark themes, deep variants on the two white
  themes, per the values above).
- **[PeriodogramChart.tsx](web/src/components/PeriodogramChart.tsx)**:
  - `colorFor(kind)` → `colorFor(kind, tc)`: `all` and `unguided` →
    `tc.fftResidual`; `all-raw-ra` → `tc.fftRawRa`; `spike` → unchanged
    (`COLOR_SPIKE` amber stays — separate mode, never co-rendered).
  - Drop the now-unused `COLOR_RESIDUAL` / `COLOR_RAW_RA` / `COLOR_UNGUIDED`
    module constants; keep `COLOR_SPIKE`.
  - Active trace `line.width` 1.5 → 2.5; counterpart `line.width` 1.25 → 1.75;
    `INACTIVE_OPACITY` 0.28 → 0.5.
  - The active trace's `fillcolor` continues to derive from the active color
    (kept subtle so the thicker line stays the focus).

## Scope / testing

UI-only. No parser/store/storage/test-logic change. Verified in the browser
across all five themes (Dark, Paper, High-contrast, Monochrome, Night): both
traces clearly readable; counterpart visible but subordinate; dual-trace
(residual + raw-RA) distinguishable; spike/unguided modes unaffected.
`tsc --noEmit` + `vitest run` stay green.

## Out of scope

- Spike-mode and unguided-mode color identity (unchanged beyond unguided now
  using the theme-aware residual amber instead of fixed lime).
- The drift/spike top chart and the GuideGraph trace colors.
