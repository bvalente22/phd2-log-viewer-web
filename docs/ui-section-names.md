# UI section names

A shared vocabulary for referring to each region of each screen by name. Use
these names when describing where a change should go. Names map to the actual
React components under [`web/src/components/`](../web/src/components/) and the
layout in [`web/src/pages/ViewerPage.tsx`](../web/src/pages/ViewerPage.tsx).

The app has no separate landing page — it always renders the viewer chrome
(header + sidebar + main pane). Until a log is loaded, the sidebar shows the
open-log drop zone and recents; the main pane shows a hint.

---

## 1. Global chrome (always on screen)

Wraps every view, from `ViewerPage.tsx`.

| Name | What it is | Component |
|---|---|---|
| **Header** (top bar) | App name + version/githash, current filename, ✎ annotate button, PHD2 version | inline `<header>` |
| **Header right cluster** | RA/Dec color picker, theme picker, language picker | `RaDecColorPicker`, `ThemePicker`, `LanguagePicker` |
| **Sidebar** | Left column; collapses to a 16px rail (chevron-only) | inline `<aside>` |
| ↳ **Open-log drop zone** | "Drop PHD guide/debug log pair here" | `LogsFolderPane` |
| ↳ **Recents dropdown** | Recently opened logs (deduped by content hash) | `RecentsDropdown` |
| ↳ **Section list** | Per-log list of GUIDING / CALIBRATION sections | `SectionList` |
| **Sidebar resizer** | Drag handle on the sidebar/main boundary; double-click resets | `SidebarResizer` |

---

## 2. Guiding section view (main pane, GUIDING section selected)

| Name | What it is | Component |
|---|---|---|
| **Graph toolbar** | RA / Dec / Guide Star / Events trace groups + Display popover + Analysis button | `GraphToolbar` |
| ↳ **Display popover** | View (Time/Scatter), Scale, Y-axis, Coord, Device, Range slider, Export (PNG/CSV) | `ToolbarPopover` |
| ↳ **Analysis button** | Opens the Analysis modal | `AnalysisButton` |
| **Section summary strip** | Always-visible filename + active-section line | `SectionSummary` |
| **Section header** | Collapsible parsed-header detail | `SectionHeader` |
| **Guiding Assistant panel** (GA results) | Guiding-Assistant run summary | `GAResultsPanel` |
| **Guiding dashboard** | Tile strip: Pier side, Exposure, Hour angle, Altitude, Rotator, AO Unit, Backlash comp, RA/Dec algorithm | `GuidingDashboard` |
| **Guide graph** (Time view) / **Scatter view** | The main chart (toggled by View) | `GuideGraph` / `ScatterView` |
| **Stats footer** (tabbed) | The footer band under the chart. A tab strip (active = amber) switches between three panels; default is **Stats**. Only the active panel renders | `StatsTabs` |
| ↳ **Stats tab** | Total row (RMS, Duration, **Aspect-Ratio** metric) + RA / Dec rows (RMS, Peak, Mean), then a small **included / excluded** frame-count line | `StatsGrid` |
| ↳ **Estimated Imaging Impact tab** | Guide-error → star-elongation estimator; header "Estimated Imaging Impact: EXPERIMENTAL" | `ImageImpact` |
| ↳ **Polar Alignment tab** | Header "Polar Alignment Error: EXPERIMENTAL" with a pill that toggles **This Section ⟷ All Sections**. Below it: total **PAE** band badge (green ≤2′ / yellow ≤5′ / red), the **Alt / Az** split, then a third line that is **RA / Dec drift** (This Section) or just the **section count** (All Sections). Plus the bullseye on the right | `PolarAlignmentPanel` |
| ↳ **PA bullseye** (target plot) | The 6′ dartboard SVG on the right of the Polar Alignment tab; dot sits at the total PAE distance and the Alt/Az angle, colored by band, with "!" low-confidence markers on the weak axis (This-Section mode). Clicking it toggles the mode too | `PolarAlignmentPlot` |

*Confidence (High/Medium/Low) is still computed for the All-Sections solve — it
gates whether the result resolves — but is no longer shown in the UI.*

*Polar-alignment math lives in the parser, not the components: per-section split in
[`polarAlignment.ts`](../web/src/parser/polarAlignment.ts), the whole-log least-squares
"All Sections" solve + confidence in
[`globalPolarAlignment.ts`](../web/src/parser/globalPolarAlignment.ts), and the
green/yellow/red band thresholds in
[`guidingMetric.ts`](../web/src/components/guidingMetric.ts). Background:
[`docs/polar-alignment-explained.md`](polar-alignment-explained.md).*

---

## 3. Calibration section view (CALIBRATION section selected)

| Name | What it is | Component |
|---|---|---|
| **Section summary strip / Section header** | Same as guiding | `SectionSummary`, `SectionHeader` |
| **Calibration dashboard** | Tiles: Pier side, Hour angle, Declination, Altitude, Azimuth, Rotator | `CalibrationDashboard` |
| **Calibration tabs** | Two-tab wrapper | `CalibrationTabs` |
| ↳ **Calibration Results tab** | Calibration plot + calibration stats | `CalibrationPlot`, `CalibrationStats` |
| ↳ **Backlash Analysis tab** | Loads a paired debug log; runs list + result panel | `BacklashTab` |

---

## 4. Analysis modal (full-screen overlay)

From `AnalysisModal.tsx`.

| Name | What it is |
|---|---|
| **Analysis banner** (amber header) | ANALYSIS wordmark + mode tabs + dataset title + Close |
| ↳ **Mode tabs** | Raw RA / Residual error / Manual Spike (Spike, Bursts, Simple Spike exist in code but are currently hidden) |
| **Analysis toolbar** | Show RA/Dec, Scale, All-frames, Y-lock, Reset Y, Top-graph show/hide |
| **Drift chart** (top chart) / **Spike chart** | The upper trace chart | 
| **Periodogram chart** | The lower FFT chart (`PeriodogramChart`) |
| **Top peaks panel** (bottom panel) | Top-3 peak cards + Max Period + Primary period field (`PrimaryPeriodField`) |
| **Manual Spike view** | Axis/Scale/Reset/Threshold-slider toolbar + `ManualSpikeChart` + period/amplitude summary |

---

## 5. Debug Log Viewer (separate overlay)

| Name | What it is | Component |
|---|---|---|
| **Debug log viewer** | Virtualized PHD2 debug-log reader (open-folder / drop-zone) | `DebugLogViewer` |

---

## 6. Modals

| Name | Component |
|---|---|
| **Annotation editor modal** ("Name this log") | `AnnotationModal` |
| **Graph context menu** (right-click on guide chart) | `ContextMenu` |
