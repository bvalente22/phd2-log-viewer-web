# Design: Resizable sidebar + hover values beneath the analysis graphs

Date: 2026-06-03

Two independent enhancements for the PHD2 Log Viewer web app:

1. A draggable handle to resize the left sidebar width.
2. Move mouse-over data labels off the analysis charts and into a readout
   strip beneath each chart — the same treatment already applied to the main
   GuideGraph (PR #58).

---

## Part 1 — Resizable sidebar

### Current state

The sidebar is the left column of a CSS grid in
[`ViewerPage.tsx`](../../../web/src/pages/ViewerPage.tsx). Its width is a
hardcoded constant:

```ts
const sidebarWidth = sidebarCollapsed ? '16px' : '260px';
// gridTemplateColumns: `${sidebarWidth} 1fr`
```

When expanded, the `<aside>` is a flex row: a `flex-1` content column followed
by a 16px-wide `‹` hide bar (a button that sets `sidebarCollapsed = true`).
When collapsed, the entire 16px rail is a single `›` expand button.

View preferences (including `sidebarCollapsed`) already persist to
localStorage via zustand's `persist` middleware + `partialize` allow-list in
[`viewStore.ts`](../../../web/src/state/viewStore.ts).

### Design

**State (`viewStore.ts`):**

- Add `sidebarWidth: number` to the state, default `260`.
- Add `setSidebarWidth(n: number)` which clamps to **[180, 480]** before
  storing: `set({ sidebarWidth: Math.max(180, Math.min(480, n)) })`.
- Add `sidebarWidth` to the `partialize` allow-list so it persists across
  sessions, like the other UI prefs.

**Constants:** `SIDEBAR_MIN = 180`, `SIDEBAR_MAX = 480`, `SIDEBAR_DEFAULT = 260`.
The clamp lives in the store so both the drag handler and any future caller
stay in bounds.

**Layout (`ViewerPage.tsx`):**

```ts
const sidebarWidth = sidebarCollapsed ? '16px' : `${width}px`;
// where `width` = useViewStore(s => s.sidebarWidth)
```

**New component `SidebarResizer`** (`web/src/components/SidebarResizer.tsx`):

A thin (~5px) full-height vertical strip rendered **immediately to the right of
the existing `‹` hide bar**, so it sits on the sidebar/main boundary and the
sidebar's right edge reads:

```
[ ……… content ……… ][ ‹ hide ][ ⇔ resizer ]
```

Interaction:

- `onPointerDown`: record `startX = e.clientX`, `startWidth = current
  sidebarWidth`, call `setPointerCapture`, set a `dragging` flag, and add
  `user-select: none` to `document.body` (removed on release) so dragging
  doesn't select page text.
- `onPointerMove` (while dragging): `setSidebarWidth(startWidth + (e.clientX -
  startX))`. The store clamps; no per-move clamping needed here.
- `onPointerUp` / `onPointerCancel`: release capture, clear the flag, restore
  body `user-select`.
- `onDoubleClick`: `setSidebarWidth(SIDEBAR_DEFAULT)` — reset to 260.

Presentation: `cursor: col-resize`, subtle slate fill matching the hide bar,
brightening on hover/drag. Accessibility: `role="separator"`,
`aria-orientation="vertical"`, `aria-valuenow={width}`, `aria-valuemin`,
`aria-valuemax`, and a native `title` tooltip — e.g. *"Drag to resize the
sidebar · double-click to reset to default width"* (per the tooltips-on-all-
interactive-UI convention; localized via the existing `common` namespace
`sidebar.*` keys).

Rendered only when the sidebar is **expanded**. When collapsed, the 16px
expand rail is unchanged and no resizer shows (there's nothing to resize at
16px).

### Edge cases

- Width is clamped in the store, so a fast drag past either bound just pins to
  the bound.
- Pointer capture keeps the drag tracking even when the cursor moves off the
  thin strip or outside the window.
- Collapse/expand is independent of width: collapsing hides the content and
  shows the 16px rail; expanding restores the persisted width.

---

## Part 2 — Hover values beneath the analysis graphs

### Current state

The main GuideGraph already does this (PR #58): its traces use
`hoverinfo:'none'`, the layout keeps `hovermode:'x'` + `xaxis.showspikes` (so
the vertical cursor spike still tracks the mouse), `plotly_hover` still fires,
and an `onHover` handler fills a fixed readout strip beneath the chart. No
value box floats on the plot itself.

The analysis charts are **inconsistent**:

| Chart | Behind which tab | Bottom strip? | On-chart popup? |
|-------|------------------|---------------|-----------------|
| `DriftChart` | Raw RA / Residual (top graph) | ✅ exists | ❌ `hovertemplate: 'RA/Dec: …'` still shows |
| `PeriodogramChart` | Raw RA / Residual (bottom graph) | ✅ exists | ❌ active-trace `hovertemplate` still shows |
| `ManualSpikeChart` | Manual Spike | ❌ none | ❌ `hovertemplate` on detrended + selected traces |
| `SpikeChart` / `SimpleSpikeChart` / `BurstChart` | hidden tabs | n/a | n/a — **out of scope** (not user-visible) |

Scope decision: **visible-tab charts only** — DriftChart, PeriodogramChart,
ManualSpikeChart. The hidden Spike/Simple/Burst charts are not touched.

### The pattern

Setting a trace's `hoverinfo:'none'` hides its floating value box while
**keeping** the `plotly_hover` event firing and the `xaxis.showspikes` cursor
line. (Only `hoverinfo:'skip'` would suppress the event.) The bottom strip,
filled by the chart's own `onHover`, becomes the single place values appear.

### Per-chart changes

**`DriftChart.tsx`** — replace the two trace `hovertemplate: 'RA: %{y:.2f}…'`
/ `'Dec: %{y:.2f}…'` with `hoverinfo:'none'`. The strip and `onHover` (Time/Y
readout) already exist and are unchanged. The pre-existing manual dashed-line
cursor (`drawCursor`/`clearCursor`) and the `showspikes` spike are left as-is —
out of scope; only the floating value boxes are removed.

**`PeriodogramChart.tsx`** — replace the active trace's
`hovertemplate: activeHoverTemplate` with `hoverinfo:'none'`, and remove the
now-dead `activeHoverTemplate` construction and the `customdata` array that
only fed it (the inactive trace already uses `hoverinfo:'skip'`; the strip's
`Period / Raw RA / Residual` readout is produced independently in `onHover`
from the splines, so it is unaffected). `onHover` keeps its `customdata`-free
logic — verify nothing else reads `customdata`.

**`ManualSpikeChart.tsx`** — the larger change, since it has no strip today:

- Replace both trace `hovertemplate`s (detrended line + selected markers) with
  `hoverinfo:'none'`.
- Add `const [hover, setHover] = useState<string | null>(null)`.
- Add an `onHover` that reads `points[0].x` / `.y`, computes the px/arc-sec
  pair (mirroring DriftChart's conversion), and sets a readout like
  `t=…s · y=…″ (…px)`; when the hovered x matches a selected pick, append a
  marker such as ` · selected`. Add `onUnhover` clearing it.
- Wire `onHover`/`onUnhover` onto `<Plot>`.
- Change the wrapper from `<div className="h-full">` to a `flex h-full
  flex-col` with the `<Plot>` in a `flex-1` div and the strip beneath, styled
  identically to the others: `border-t border-slate-800 bg-slate-900/40 px-3
  py-1 font-mono text-[11px] text-slate-300 min-h-[24px]`, with a `title`
  tooltip. The existing pointer-capture pick handlers (left-click add /
  right-click remove) are unaffected — they map cursor → data via Plotly's
  pixel layout, and the plot area simply gets ~24px shorter.

Readout text stays hardcoded English to match the existing Drift / Periodogram
/ Spike strips. A new `manualSpike.hoverTooltip` key is added under the
`analysis` i18n namespace for the strip's `title`.

---

## Testing

- `npx tsc --noEmit` and `npx vitest run` clean.
- Confirm `web/e2e/analysis.spec.ts` (and `spike-analysis.spec.ts`) don't
  assert against the removed on-chart popups; adjust if they do.
- Browser verification (per the "test every chart interaction" rule):
  - **Analysis charts** — open Raw RA, Residual error, and Manual Spike tabs;
    hover each chart and confirm (a) no floating value box appears on the plot,
    (b) the vertical cursor spike still tracks, (c) the bottom strip fills with
    the readout. Exercise drag (X pan + Y zoom), right-drag, and wheel zoom to
    confirm gestures still work. On Manual Spike, confirm left-click add /
    right-click remove still pick points with the strip present.
  - **Sidebar** — drag the handle to widen/narrow (confirm clamping at the
    bounds), double-click to reset to 260, reload the page to confirm the width
    persisted. Confirm collapse/expand still works and the resizer hides when
    collapsed.
  - Spot-check a dark and a light theme.

## Out of scope

- The hidden Spike / Simple / Burst analysis charts.
- DriftChart's redundant manual cursor vs. native spike (pre-existing).
- Any change to the collapse/expand behavior itself.
