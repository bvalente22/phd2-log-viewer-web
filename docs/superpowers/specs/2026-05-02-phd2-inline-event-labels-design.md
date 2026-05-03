# PHD2 Log Viewer — Inline Event Labels on the Time Graph

**Status:** Design approved 2026-05-02
**Predecessors:** v1 / v2 / v3 / Logs Folder Browser. Current `main` is v0.4.0.
**Source app:** `LogViewFrame.cpp:1814-1842` — the desktop "events" checkbox that draws each `INFO` event's text directly on the chart.

---

## 1. Goal

Add an opt-in toggle that draws each session's `INFO` event text **inline on the time graph**, anchored to the same vertical position the existing dotted line already marks. This is a port of the desktop checkbox labelled "Events" that draws inline collision-stacked text onto the wxWidgets DC. The web port replicates the visible behavior using Plotly annotations.

The existing per-event tooltip (invisible hover targets at `y = yMax * 0.95`) and dotted vertical lines (yellow for INFO, purple for DITHER) stay as-is. The new feature is **additional**, not a replacement, and is off by default so it does not surprise existing users.

## 2. Non-goals (deferred)

- **Per-event styling controls.** Color and font come from the trace it represents (yellow / purple) — no user-configurable palette.
- **Click-to-jump or click-to-edit.** Labels are decorative; their hover text is the same as the existing transparent marker layer.
- **Scatter-view labels.** Scatter is a (RA, Dec) phase plot; events have no spatial position there. The toggle is disabled (greyed) when `graphMode === 'SCATTER'`.
- **Calibration / phase-2 sections.** Cal sections render via `CalibrationPlot`; events only appear in `GUIDING` sections, which is what the desktop also does.
- **Sticky vs. floating labels at extreme zoom.** Whatever Plotly does with annotations whose `x` is outside `xaxis.range` is what we accept (Plotly auto-clips). The desktop short-circuits the same way.
- **Truncation / ellipsis of long event text.** The desktop draws the raw string at full width and lets it overflow horizontally; we do the same.

## 3. Source-app reference

`LogViewFrame.cpp:1814-1842`:

```cpp
if (m_events->IsChecked())
{
    int i1 = std::min((int)entries.size(), (int)floor(ginfo.i1));
    const GuideSession::InfoVec& infos = m_session->infos;
    int prev_end = -999999;
    int row = 1;
    for (auto it = infos.begin(); it != infos.end(); ++it)
    {
        const auto& info = *it;
        if (info.idx > i1) break;
        wxString s = info.repeats > 1
            ? wxString::Format("%d x %s", info.repeats, info.info)
            : wxString(info.info);
        int width = dc.GetTextExtent(s).x;
        int xpos = info.idx * ginfo.hscale - ginfo.xofs;
        if (info.idx <= (int)i0) {
            if (xpos + width <= 0) continue;
        }
        if (xpos < prev_end + 10) ++row;
        else row = 1;
        if (xpos + width > prev_end) prev_end = xpos + width;
        dc.DrawText(s, xpos, m_graph->GetSize().GetHeight() - 16 * row);
    }
}
```

Two characteristics of this loop matter for the port:

1. **Row stacking is screen-pixel relative.** Two events whose `xpos` are within `10 px + textWidth` get pushed onto a higher row. Each row is `16 px` tall and stacks **upward** from the bottom of the graph.
2. **Repeats are folded into the label** as `"N x text"` (e.g. `3 x DITHER 0.5, 0.5`). The web parser already records `repeats` on each `InfoEntry`, and the existing tooltip renders this as `text ×N`. The inline label uses the same `×N` style for visual consistency with the hover tooltip — porting the desktop intent (show repeats) without porting the desktop's exact `N x text` typography.

## 4. UI

### 4.1 Toolbar toggle

Add one new chip to `GraphToolbar`'s existing **`show:`** row, immediately after `SNR`:

```
show: RA  Dec  RA pulses  Dec pulses  Mass  SNR  Events
```

Behavior:

- **Active state:** white text on `bg-sky-700` (matches the other `ToggleChip` style).
- **Disabled when `graphMode === 'SCATTER'`** (matches the existing trace toggles).
- **Tooltip:** `"Show INFO events as inline labels on the chart"`.
- **Default:** off.
- **Persisted** in `viewStore.traces.events` via the existing `partialize` allow-list.

### 4.2 Rendering

Each non-empty `s.infos` entry produces a Plotly `Annotation` object inside `layout.annotations`. Annotations are placed:

- **`x`:** `s.entries[info.idx].dt` (same x-coordinate as the existing dotted line).
- **`xref`:** `'x'`.
- **`y`:** `0` with `yref: 'paper'` and `yanchor: 'bottom'`. This pins the label to the bottom edge of the plot area regardless of zoom or auto-Y choices.
- **`xanchor`:** `'left'`. The label extends to the right of the dotted line, like the desktop.
- **`text`:** `info.repeats > 1 ? `${info.info} ×${info.repeats}` : info.info` (same string the hover tooltip already uses).
- **`showarrow`:** `false`.
- **`bgcolor`:** `'rgba(15,23,42,0.85)'` (slate-900 at 85% — keeps text readable when crossing trace lines).
- **`bordercolor`:** the dotted-line color for that event (`rgba(168,85,247,0.7)` for DITHER, `rgba(250,204,21,0.4)` otherwise).
- **`font`:** `{ size: 10, color: 'rgb(226,232,240)' }` (slate-200; default chart font family).
- **`yshift`:** `row * 14` (px). `row` is 0-indexed and computed by the layout helper described in §4.3. The desktop used `16 * row` against a larger DC font; 14 px matches the chosen 10-px web font with breathing room.

### 4.3 Row-stacking helper (`eventLayout.ts`)

The desktop's `xpos < prev_end + 10` logic runs **in screen pixels**, not data units, because the spacing rule is "did the previous label visually run into this one?". To do the same in the web port, the helper computes rows from a sorted list of `(timeSec, textWidthPx)` tuples and a `pxPerSecond` factor.

Pure function signature:

```ts
export interface EventInput {
  timeSec: number;
  text: string;
  isDither: boolean;
}

export interface EventLayoutItem extends EventInput {
  /** 0-indexed row from the bottom. row=0 = lowest, row=1 = stacked above, etc. */
  row: number;
}

export function layoutInlineEvents(
  events: EventInput[],
  pxPerSecond: number,
  measureTextPx: (text: string) => number,
): EventLayoutItem[];
```

Algorithm (mirrors `LogViewFrame.cpp:1814-1842`):

```
sort events by timeSec ascending  (parser already maintains this; sort is a guard)
prev_end_px = -Infinity
row = 0
for each event:
    xpos_px = event.timeSec * pxPerSecond
    width_px = measureTextPx(event.text)
    if xpos_px < prev_end_px + 10:
        row += 1
    else:
        row = 0
    if xpos_px + width_px > prev_end_px:
        prev_end_px = xpos_px + width_px
    emit { ...event, row }
```

`measureTextPx` is injected so the unit test can pass a deterministic fake (e.g. `text => text.length * 6`). In production we use a memoized hidden `<canvas>` `measureText` call with the chart's font.

`pxPerSecond` is derived from the current x-axis range and plot width. `GuideGraph` already tracks `xExtent` (data range) and the chart's pixel width is read from the Plotly graph div on `relayout`, so we can compute it inline:

```ts
const pxPerSecond = chartWidthPx / (xExtent[1] - xExtent[0]);
```

### 4.4 Re-layout on zoom

Because row stacking depends on the current `pxPerSecond`, the labels need to re-flow when the user zooms. `GuideGraph` already wires `onRelayout` for other concerns; the events feature taps the same callback:

- On `relayout`, recompute `pxPerSecond` from the new `xaxis.range` and the unchanged plot width.
- Rebuild the annotations array via `layoutInlineEvents`.
- Issue `Plotly.relayout(div, { annotations: nextAnnotations })`.

This is the same pattern the analysis modal's vertical-cursor code uses, and it costs ~1 ms for typical session sizes (<200 events).

## 5. State

### 5.1 New flag in `viewStore.traces`

```ts
export interface TraceVisibility {
  ra: boolean;
  dec: boolean;
  raPulses: boolean;
  decPulses: boolean;
  mass: boolean;
  snr: boolean;
  events: boolean;          // ← new, default false
}
```

`traces.events: false` ships in the initial state object. The persisted `traces` object (already in `partialize`) automatically picks up the new key. Existing users with persisted `traces` from before this change will deserialize without `events`; the store falls back to the default `false` because Zustand `persist`'s `merge` step shallow-merges incoming partials onto the fresh initial state.

### 5.2 No new selectors

`useViewStore((s) => s.traces)` already returns the whole `TraceVisibility` object. Components consuming `traces.events` do not need a new selector hook.

## 6. Architecture

```
┌──────────────┐ traces.events  ┌───────────────────────┐
│ GraphToolbar │ ─────────────► │ viewStore (persisted) │
└──────────────┘                └───────────┬───────────┘
                                            │
                                            ▼
                                  ┌──────────────────┐
                                  │ GuideGraph.tsx   │
                                  │  - reads traces  │
                                  │  - on relayout:  │
                                  │      compute     │
                                  │      pxPerSecond │
                                  │      → call      │
                                  │      layoutInline│
                                  │      Events()    │
                                  │  - sets layout   │
                                  │    .annotations  │
                                  └──────────────────┘
                                            ▲
                                            │ (pure helper)
                                  ┌──────────────────┐
                                  │ eventLayout.ts   │
                                  │ + tests          │
                                  └──────────────────┘
```

The pure helper lives outside `GuideGraph` so it has no Plotly / DOM coupling and stays trivially testable.

## 7. Files touched

**Create:**

- `web/src/components/eventLayout.ts` — pure row-stacking helper + `MeasureTextFn` type.
- `web/src/components/__tests__/eventLayout.test.ts` — vitest suite covering: empty, single, two non-overlapping, two overlapping (row stacks), three with second-and-third overlap, repeat-formatting passes through.
- `web/e2e/events-toggle.spec.ts` — Playwright e2e: toggle on, assert at least one annotation rendered with INFO text; toggle off, assert no inline annotations remain. (Use Plotly's DOM annotations layer, not internal state.)

**Modify:**

- `web/src/state/viewStore.ts` — add `events: boolean` to `TraceVisibility` and to the initial `traces` object.
- `web/src/components/GraphToolbar.tsx` — add the `Events` chip to the `show:` row's `items` array.
- `web/src/components/GuideGraph.tsx`
  - Read `traces.events` from the view store.
  - Build the events annotation list when the toggle is on.
  - Recompute on `onRelayout` (existing handler).
  - Pass `annotations` through `useMemo` so it doesn't re-allocate on every render.
- `web/src/components/__tests__/GuideGraph.test.tsx` (if present) — extend smoke test for the new path; otherwise no change.

## 8. Edge cases & invariants

- **Zero events** (`s.infos.length === 0`): toggle is still enabled but does nothing — annotations array stays `[]`. No empty-state UI.
- **Toggle off → on with persisted state:** annotations array re-derives from current data on the next render. No animation; the labels appear immediately.
- **Section change:** annotations re-derive because the memoized data depends on the active session and `xExtent`. The previous section's labels never bleed into the next.
- **Excluded ranges:** events inside an excluded run are still labelled (matches the desktop, which also shows them — exclusion does not mean "deleted from the timeline").
- **Repeat clusters:** `info.repeats > 1` becomes one label, not many. Already enforced by the parser; the label code reads the existing field.
- **Auto-Y / locked-Y:** annotations use `yref: 'paper'`, so they stay at the chart bottom regardless of Y-axis choices.
- **Tooltips still work:** the existing transparent hover-target trace at `y = yMax * 0.95` is independent of the new annotations, so hovering near the top of the chart continues to show the event tooltip even when inline labels are off.

## 9. Testing

### 9.1 Unit tests (`eventLayout.test.ts`)

- `empty input → []`.
- `single event → row=0`.
- `two events 1 hour apart, narrow text → both row=0`.
- `two events 1 second apart, wide text → second is row=1`.
- `three events with progressively closer spacing → rows [0, 1, 2]`.
- `wider pxPerSecond (zoomed in) demotes overlap → rows [0, 0]`.
- `narrower pxPerSecond (zoomed out) promotes overlap → rows [0, 1]`.
- `repeats text with ×N suffix is preserved verbatim by the helper` (helper does not format; formatting is the caller's concern).

### 9.2 E2E (`events-toggle.spec.ts`)

- Drop the synthetic fixture, click into the guiding section.
- Initially: assert `g.annotation-text` count is `0` (Plotly's annotation DOM class).
- Click the `Events` chip → assert `g.annotation-text` count is `>= 1` and at least one contains the synthetic fixture's known INFO text (e.g. `state=1`).
- Click `Events` again → assert count back to `0`.
- Switch to the scatter view → assert the chip is `disabled`.

## 10. Risk & rollback

- **Risk:** measureText canvas operations on every relayout could cause jank with very large `infos` arrays (>1000). Mitigation: cache `measureTextPx(text)` per-text-string in a Map for the lifetime of the session.
- **Risk:** Plotly annotation re-layout on every wheel-zoom could feel sluggish. Mitigation: the existing `onRelayout` is already rAF-throttled by `react-plotly.js`; we don't add a second debounce.
- **Rollback:** revert the modify-set; the new file (`eventLayout.ts`) and tests can stay or be deleted. No data migration needed because the new `traces.events` key is additive and defaults to `false`.

## 11. Future work (explicitly out of scope)

- Show events on calibration plots when calibration produced a recognized "starting calibration" / "calibration complete" pair.
- Filter chips for *which* event categories to label (e.g. `dithers only`, `parameter changes only`).
- Smart truncation when two adjacent labels' rendered widths exceed the chart width — current behavior is to overflow horizontally, the same as the desktop.
- A "highlight on hover" connection between an inline label and its dotted line.
