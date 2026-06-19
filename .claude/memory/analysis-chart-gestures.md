# Analysis charts — gestures & view persistence

**Source of truth: the `Cross-session context` section of [`../../CLAUDE.md`](../../CLAUDE.md).** This is a granular per-topic copy.

Chart pan/zoom across the app is custom, not Plotly's built-in drag.

- **Shared gesture hook:** `web/src/components/useChartGestures.ts`. Plotly is
  set `dragmode:false`; the hook owns interaction via pointer events +
  `Plotly.relayout`. **Left-drag = pan X + zoom Y** (center-anchored);
  **right-drag = pan Y + zoom X**; shift/ctrl-drag = include/exclude range.
  Scroll-zoom is Plotly's built-in `scrollZoom`.
- **Each chart must persist its own view in a store**, or hover/drag re-renders
  snap the axis range back to the data-derived default. Drift chart:
  `driftXRangeView` + `driftYRangeView` in `analysisStore` (Y added in #117);
  periodogram: `periodXRangeViewLog` + `yMaxViewPx`; main GuideGraph:
  `sectionViews`. The component feeds the stored view into
  `layout.{x,y}axis.range` on every render.
- **Gotcha — `yaxis.fixedrange:true` does NOT block programmatic
  `Plotly.relayout` of the range.** It only disables user scroll/drag zoom on
  that axis. So charts keep `fixedrange:true` to constrain *scroll* to X while
  the custom handler still drag-zooms Y. (Proven by GuideGraph's shipped
  "recenter-Y".) The drift-chart Y-zoom was broken (#117) purely because Y was
  not persisted — every drag frame's X-store update re-rendered and snapped the
  un-tracked Y back — NOT because of fixedrange.
- **Decision:** the drift chart's X/Y view (like the periodogram) persists across
  the **Raw RA / Residual / Manual Spike** mode swaps **and** across px↔arcsec
  scale flips — it is NOT auto-reset on scale flip (`setScaleMode` resets
  nothing; matches the periodogram). Resets only on modal (re)open. A Y view in
  px units is therefore technically stale after a scale flip — accepted for
  consistency with the periodogram and the user's "remember zoom/pan" request.
- **Deferred follow-up:** a drift-chart "Reset Y" affordance. The existing
  "Reset Y" button is periodogram-only (`resetYZoom` → `yMaxViewPx`). A drift
  reset would also clear a scale-flip-stale Y. Not built — left to match
  existing behavior.

Related: `tabbed-stats-footer.md`, `ci-pages-deploy.md`.
