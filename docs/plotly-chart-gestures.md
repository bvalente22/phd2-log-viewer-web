# Plotly Chart Gesture Conventions

A portable spec for pan / zoom / range-select behavior on Plotly charts.
Every Plotly chart in the project must follow it so interactions feel identical
everywhere. Implement the gestures with a **single custom pointer-event handler**;
do **not** use Plotly's built-in drag modes.

Tested against Plotly.js 2.x. Framework-agnostic, with React-specific notes called
out where they matter.

---

## Using this doc in a project

1. Copy this file into the target repo (e.g. `docs/plotly-chart-gestures.md`).
2. Add a line to the repo's agent instructions (`CLAUDE.md` / `AGENTS.md` /
   `.cursorrules` / `.github/copilot-instructions.md`):

   > All Plotly charts must follow `docs/plotly-chart-gestures.md`. When you create
   > or edit any chart, read that file first and apply every rule in it. Do not use
   > Plotly's built-in drag modes (box-zoom, pan) or its built-in y-axis
   > scroll-zoom — the custom pointer handler owns drag.

3. Treat **Required gestures** and **Plotly configuration** as hard requirements,
   and **Implementation requirements** as the checklist that makes it actually
   work. Verify with the **Definition of done** in a real browser.

---

## Required gestures

- **Left-click drag** = pan X **and** zoom Y simultaneously.
  - Horizontal motion pans the X axis (data follows the cursor).
  - Vertical motion zooms Y multiplicatively: drag **up** = zoom **in** (smaller Y
    span), drag **down** = zoom out. Use `factor = Math.exp(dy / 200)` (≈200 px of
    vertical travel halves/doubles the span); `newSpan = oldSpan * factor`.
  - Y zoom is anchored on the **current Y-range center** by default (symmetric
    scaling around the midpoint, so it feels the same wherever you click and
    survives Y panning). Provide a **'bottom' anchor** option for charts whose
    lower bound is a semantic baseline (e.g. an amplitude / periodogram that is
    always ≥ 0): keep y0 fixed and scale only y1.
- **Mouse wheel / scroll** = zoom **X only** (Y stays fixed).
- **Shift + drag** = horizontal range *select / include* — fires a callback with
  the selected X range; draw a translucent overlay rectangle while dragging.
- **Ctrl/Cmd + drag** = horizontal range *exclude* — same mechanism, different
  callback and overlay color.
- **Double-click** = disabled (no autoscale-reset).

(Shift/Ctrl-drag selection is optional per app. If your charts don't need
range-select, keep the plain-drag and wheel behavior and the modifier branches can
be omitted — but keep the option of adding them without changing the core handler.)

---

## Plotly configuration

This is what makes wheel = X-zoom and disables the built-in interactions:

- `layout.dragmode = false`
- `layout.yaxis.fixedrange = true`  ← makes Plotly's `scrollZoom` act on X only
- `config.scrollZoom = true`
- `config.doubleClick = false`
- A stable `layout.uirevision` (constant per chart/dataset) so framework
  re-renders don't reset the user's pan/zoom.

---

## Implementation requirements / gotchas

Each of these fixed a real, reproducible bug. Skipping them produces subtle
breakage that looks fine at first.

1. **Use Pointer Events + `setPointerCapture` on the stable chart container div**,
   not on `event.target`. Plotly re-renders and detaches inner SVG/WebGL nodes on
   every relayout you issue mid-drag; capturing the target releases capture after
   one frame. Capturing the container keeps every `pointermove`/`pointerup` flowing
   even when the cursor crosses Plotly's hover / scattergl layers (which otherwise
   hijack the events and "freeze" the pan/zoom).
2. Attach `pointerdown` in the **capture phase** and call `preventDefault()` +
   `stopPropagation()` so Plotly's own hover/selection handlers don't fight you.
   Listen for `pointermove`/`pointerup`/`pointercancel` **on the container div**
   (not `window`) — pointer capture redirects events to the captured element.
3. **React only:** keep callbacks and live options in refs (`useRef`), and do
   **not** list them in the gesture effect's dependency array. If the effect
   re-runs mid-drag (e.g. a parent passes a fresh callback object literal each
   render), the listener is torn down and reinstalled with fresh state, the
   drag-kind resets to `null`, and the drag "stops after a short distance." Install
   listeners once; let refs carry updates.
4. **Hit-test the plot area by geometry, not SVG ancestry.** Check the pointer
   against `_fullLayout.xaxis._offset/_length` and `_fullLayout.yaxis._offset/_length`.
   An ancestor check (e.g. testing for `.nsewdrag`) refuses drags that start on an
   annotation label, which renders in a layer above the drag layer.
5. **Date axes:** `_fullLayout.xaxis.range` holds ISO date strings
   (`"YYYY-MM-DD HH:mm:ss.sss"`) on `type:'date'` axes and numbers otherwise.
   Coerce to numeric ms before any arithmetic (`Date.parse` for strings), or
   `range[1] - range[0]` yields `NaN` and the chart snaps to a 1970-epoch range.
6. **rAF-throttle** the `Plotly.relayout` calls during a drag — coalesce patches in
   a single `requestAnimationFrame`; flush the final patch on `pointerup`.
7. Call `Plotly.relayout(divElement, patch)` with the captured **element
   reference**, not the string graph id — robust to id drift across remounts.
8. Build the relayout patch as
   `{ 'xaxis.range': [x0, x1], 'yaxis.range': [y0, y1] }`. Offer a
   **"disable Y zoom"** mode that omits the `yaxis` key, for charts whose Y range
   is pinned by an external lock (e.g. a "Y locked" toggle).

---

## Reference pseudocode (framework-agnostic)

```
onPointerDown(e):
  if e.button != 0 or not isInPlotArea(e): return
  div.setPointerCapture(e.pointerId)          // capture on the CONTAINER
  if e.shiftKey:  kind = 'INCLUDE'; startOverlay(); return
  if e.ctrlKey || e.metaKey: kind = 'EXCLUDE'; startOverlay(); return
  kind = 'PAN_ZOOM'
  startX = e.clientX; startY = e.clientY
  startXRange = numericRange(xaxis.range)     // coerce date strings -> ms
  startYRange = numericRange(yaxis.range)
  e.preventDefault(); e.stopPropagation()

onPointerMove(e):
  if kind == null or e.pointerId != activePointerId: return
  if kind == 'PAN_ZOOM':
    dx = e.clientX - startX
    dxData = (dx / xaxis._length) * (startXRange[1] - startXRange[0])
    newX = [startXRange[0] - dxData, startXRange[1] - dxData]
    factor = exp((e.clientY - startY) / 200)  // up = zoom in
    if anchor == 'bottom':
      newY = [startYRange[0], startYRange[0] + (startYRange[1]-startYRange[0]) * factor]
    else: // center
      c = (startYRange[0]+startYRange[1]) / 2
      half = (startYRange[1]-startYRange[0]) * factor / 2
      newY = [c - half, c + half]
    queueRelayout({ 'xaxis.range': newX, 'yaxis.range': newY })   // rAF-throttled
  else:
    updateOverlayRect(e)                       // selection rectangle

onPointerUp(e):
  if kind in ('INCLUDE','EXCLUDE'): emit selected X range -> callback
  flush pending relayout; releasePointerCapture(); kind = null
```

---

## Definition of done

Verify in a real browser (not just unit tests / visual inspection):

- Plain drag pans X and zooms Y; up = zoom in, down = zoom out.
- Wheel zooms X only; Y stays put.
- Shift-drag and Ctrl/Cmd-drag select ranges (if the app uses them).
- A drag that **starts on an annotation/label** still pans (geometry hit-test).
- Date-axis charts never jump to 1970 (numeric coercion).
- Chained drags keep working; pan/zoom **survives theme/data/locale re-renders**
  (stable `uirevision`, listeners not torn down).
- No console errors; hover still works.
