# Guiding/calibration header-area tweaks

Date: 2026-05-27
Branch: `ui/header-area-tweaks`

Four small, UI-only changes to the top-of-pane header area for guiding and
calibration sections. No parser/FFT/test changes.

## 1. Drop the dashboard "Guiding setup" label

`web/src/components/GuidingDashboard.tsx` — remove the full-width section-label
span (`{t('dashboard.sectionLabel')}`). **Keep** the left accent rail
(`borderLeft: 3px solid var(--dash-accent)`) and the accent-colored tile captions
so the strip still stands out. Tiles fill the freed space.

The `sections.dashboard.sectionLabel` i18n key is intentionally **left in place**
(now unused) in all six locales — not worth editing 6 files to drop one string,
and harmless.

## 2. Remove the dither/info/excluded legend

`web/src/components/GraphToolbar.tsx` — delete the "Row 4 — LEGEND" block (the
dither / info / excluded key, currently lines ~422-442) and its comment. This
strip is guiding-only (the toolbar only renders for guiding); calibration never
had it. The `toolbar.legend.*` keys are left in place (unused), as above.

## 3. Move the filename/section line above the header

`web/src/pages/ViewerPage.tsx` — swap the order of `<SectionSummary>` (the
always-visible "filename · Guide·date · (N of M)" strip) and `<SectionHeader>`
(the collapsible raw-header block) in BOTH section branches:

- Guiding: `GraphToolbar → SectionSummary → SectionHeader → GAResultsPanel →
  GuidingDashboard → chart → StatsGrid`
- Calibration: `SectionSummary → SectionHeader → CalibrationTabs`

(The chart toolbar stays at the very top for guiding; the filename line sits
directly above the collapsible header. Calibration has no toolbar, so the
filename line is the first element there.)

## 4. Segment numbers in the sidebar section list

`web/src/components/SectionList.tsx` — prefix each row with its 1-based combined
index, formatted `N)` (e.g. `1)`, `2)`), matching the same ordinal as the
`(N of M)` position in `SectionSummary`. Render as a muted `tabular-nums` span
immediately before the label so the numbers right-pad consistently:

```tsx
<span className="font-normal tabular-nums text-slate-500">{i + 1})</span>
<span className="break-words font-normal">{label}</span>
```

Both calibration and guiding rows get a number; numbering is continuous across
the combined list (calibration and guiding interleaved in log order), so e.g. a
log that starts with a calibration reads `1) Cal …`, `2) Guide …`, etc.

## Verification

UI-only; no unit tests (repo verifies chart/layout in-browser). Confirm:
- Guiding section: filename line now above the collapsible header; no
  dither/info/excluded legend in the toolbar; dashboard has no "Guiding setup"
  label but keeps its accent rail + captions.
- Calibration section: filename line above the collapsible header; sidebar rows
  numbered.
- Sidebar list shows `1)`, `2)`, … in log order for both section types.
- `npx tsc --noEmit` clean; `npx vitest run` green.
