# Tabbed guiding stats footer — design

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — pending implementation plan

## Problem

On a GUIDING section the footer band under the chart shows everything at once,
side by side: the `StatsGrid` (RMS rows + frame counts **and** the Polar
Alignment readout + bullseye) plus the `ImageImpact` panel. Three unrelated
concerns compete for one always-on strip; it is tall, and the polar-alignment
and imaging-impact blocks are both still maturing.

## Goal

Put the three concerns behind a tab strip in the same footer band, so only one
shows at a time. Default to the lightest one (Stats), which frees vertical space
for the chart. Flag the two in-progress panels as EXPERIMENTAL.

## Design

### Tabs

A tab strip lives at the top of the footer band, mirroring the existing
`CalibrationTabs` pattern (pill `TabBtn`, strip styled
`border-b border-slate-800 bg-slate-900/40 px-2 py-1`). Only the active tab's
content renders. Left → right, default **Stats**:

1. **Stats** — Total row (RMS, Duration, Aspect-Ratio metric badge) + RA / Dec
   rows (RMS, Peak, Mean) + the included / excluded frame-count line. No
   bullseye.
2. **Estimated Imaging Impact** — the existing `ImageImpact` panel, unchanged
   except its in-panel title becomes **"Estimated Imaging Impact EXPERIMENTAL"**.
3. **Polar Alignment** — the PA readout (the **This Section ⟷ All Sections**
   mode toggle, total PAE band badge, Alt / Az split with "!" low-confidence
   markers, and the drift / confidence line) **plus** the bullseye plot, both
   relocated here from `StatsGrid`. In-panel heading becomes **"Polar Alignment
   Error: EXPERIMENTAL"**. The bullseye's click-to-toggle and the mode toggle
   are preserved inside this tab.

### Behavior

- Tab state is **component-local and resets to Stats on every section switch**,
  exactly as `CalibrationTabs` does (its comment makes this an intentional
  convention: the first tab comes up fresh on each section change).
- Tab buttons reuse the `CalibrationTabs` `TabBtn` look (active = amber). This
  is a default we will audition in the running web UI and may retune.
- Because only one panel renders, the default Stats tab is shorter than today's
  combined footer (more chart height); selecting Imaging Impact or Polar
  Alignment grows the band to fit that panel.

### Components

Split rather than one component with an internal `if` — matches how
`CalibrationTabs` composes child components and gives each tab a clean boundary.

- **`StatsTabs.tsx`** (new) — the wrapper. Holds the local tab state and the tab
  strip; renders `StatsGrid`, `ImageImpact`, or `PolarAlignmentPanel`.
  `ViewerPage` renders `<StatsTabs />` in place of the current
  `<div className="flex …"><StatsGrid/><ImageImpact/></div>` footer block.
- **`StatsGrid.tsx`** — slimmed to just the guiding stats rows + frame-count
  line. The PA area, the bullseye, and the `computeGlobalPolarAlignment` call
  move out.
- **`PolarAlignmentPanel.tsx`** (new) — the PA readout + `PolarAlignmentPlot`
  bullseye + the global ("All Sections") solve, lifted out of `StatsGrid`. Owns
  the `paView: 'section' | 'all'` state and the `computeGlobalPolarAlignment`
  call.
- **`ImageImpact.tsx`** — unchanged except the title string.

`PolarAlignmentPlot.tsx` (the bullseye SVG) and all parser modules
(`polarAlignment.ts`, `globalPolarAlignment.ts`, `guidingMetric.ts`) are
untouched.

### i18n

- Tab labels: new `statsTabs.*` block in `common.json` (mirrors
  `calibrationTabs.*`) with label + tooltip keys, added to all six locales (de,
  en, es, fr, it, zh). English label text: **Stats**, **Imaging Impact**, **Polar
  Alignment** (the tab labels stay short; the full "Estimated Imaging Impact
  EXPERIMENTAL" / "Polar Alignment Error: EXPERIMENTAL" strings live in the
  panel headers, not the tabs).
- EXPERIMENTAL headers live in the `stats` namespace:
  - `imageImpact.title`: `"Estimated Imaging Impact"` → `"Estimated Imaging
    Impact EXPERIMENTAL"` in all six locales.
  - `rows.polarAlign`: `"Polar Alignment Error"` → `"Polar Alignment Error:
    EXPERIMENTAL"` in all six locales.
- "EXPERIMENTAL" stays an English status word across locales (same convention as
  the RA / Dec jargon that is kept English everywhere). It renders as appended
  plain text; promoting it to a small amber badge is a live-audition tweak, not
  a blocker.

### Testing

- Pure logic is untouched, so the existing `polarAlignmentPlot.test.ts`,
  `polarAlignment.test.ts`, `globalPolarAlignment.test.ts`, `stats.test.ts`, and
  `guidingMetric.test.ts` stand as-is.
- Add a `StatsTabs` component test: defaults to the Stats tab, and clicking the
  Imaging Impact / Polar Alignment tabs swaps the rendered panel.
- tsc + vitest run from the G: drive via node (NAS toolchain note); keep them
  green.

### Auditioning

Run the web dev server and click through the three tabs to confirm the layout,
then tune the active-tab color and whether "EXPERIMENTAL" should be a styled
badge — live, in the browser.

## Out of scope

- No change to the PA math, confidence model, or the bullseye geometry.
- No persistence of the selected tab across sessions or section switches.
- No change to the calibration view or its tabs.
