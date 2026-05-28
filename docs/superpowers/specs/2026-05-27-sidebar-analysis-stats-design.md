# Sidebar bar + Analysis button + stats-footer tweaks

Date: 2026-05-27
Branch: `ui/sidebar-analysis-stats`

Three UI changes (choices made via visual-companion mockups). UI-only; no
parser/FFT/test changes.

## 1. Sidebar hide/expand → thin monochrome chevron bar (both states)

`web/src/pages/ViewerPage.tsx`. Today: collapsed = a full 32px **amber** rail
(`›` + vertical "Expand" text); expanded = a top strip with an **amber** "‹ Hide"
button. Make both states a thin **16px** (half of 32px) full-height bar with just
a chevron, no words, in subtle monochrome slate (chosen option B).

- Collapsed grid column: `32px` → `16px` (`sidebarWidth`).
- Collapsed: the 16px rail is the expand button — `bg-slate-800 text-slate-400
  hover:bg-slate-700 hover:text-slate-200`, centered `›` (text-sm), no text.
- Expanded: restructure the `<aside>` from `flex flex-col` to `flex` (row):
  `[ content column (flex-1, min-w-0, flex-col) | 16px hide bar ]`. The content
  column holds the "Logs & Sessions" title strip (button removed), `LogsFolderPane`,
  `RecentsDropdown`, and the scrollable `SectionList`. The hide bar is a `w-4`
  full-height button on the right edge (`border-l border-slate-800 bg-slate-800
  text-slate-400 hover:bg-slate-700 hover:text-slate-200`, centered `‹`).
- Preserve `title`/`aria-label` (`sidebar.expandTooltip` / `sidebar.collapseTooltip`
  / `sidebar.expand` / `sidebar.collapse`). The visible "Expand"/"Hide" text is
  dropped; `sidebar.expand`/`sidebar.hide` keys stay (used for aria/label).

## 2. Move the Analysis button into the toolbar (right-aligned)

Chosen option A. Today `<AnalysisButton />` is a chart overlay pinned bottom-left
in `ViewerPage`. Move it to the chart toolbar's display-options row, right-aligned.

- `web/src/pages/ViewerPage.tsx`: remove the absolute bottom-left overlay wrapper
  (`<div className="pointer-events-none absolute bottom-3 left-3 z-10">…</div>`)
  and drop the now-unused `AnalysisButton` import.
- `web/src/components/GraphToolbar.tsx`: import `AnalysisButton`; render it as the
  last item of Row 2 (the display row) inside a right-pushing wrapper
  (`<div className="ms-auto"><AnalysisButton /></div>`). The button keeps its
  prominent amber styling (`bg-amber-700 px-3 py-1 text-xs font-semibold`), which
  stands out among the `px-2 py-0.5` slate chips. `AnalysisButton` itself is
  unchanged (it already returns null for non-guiding sections, and the toolbar
  only renders for guiding).

## 3. Elevated background for the stats footers

Chosen option B (elevated, no accent rail). Both summary-stat footers currently
share the chart's background (`bg-slate-900/40`), so they look merged. Give them
the dashboard's elevated tone.

- `web/src/pages/ViewerPage.tsx` (guiding `StatsGrid` wrapper) and
  `web/src/components/CalibrationTabs.tsx` (calibration `CalibrationStats` wrapper):
  change `border-t border-slate-800 bg-slate-900/40` → `border-t border-slate-700
  bg-slate-800`. `bg-slate-800` retints per theme (paper/mono/hc/night) exactly
  like the dashboard tiles, so it stays separated on every skin.

## Deferred (backlog — NOT in this change)

Gesture-hint line removal, toolbar reorganization, GuideGraph event-label stacking,
and moving GuideGraph's hover readout below the chart. See `project_backlog.md`.

## Verification

UI-only; no unit tests. Confirm in-browser:
- Sidebar: collapse → a thin 16px slate bar with `›`; expand bar (`‹`) on the
  sidebar's right edge; both subtle, no words; toggling works; tooltips intact.
- Analysis button: now at the right end of the chart toolbar; opens the modal;
  no longer floating on the plot.
- Stats footers (guiding + calibration): visibly raised vs the chart above.
- `npx tsc --noEmit` clean; `npx vitest run` green.
