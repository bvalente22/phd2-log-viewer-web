# Plotly Chart Gesture Conventions (portable, navigation-only)

A drop-in spec for **pan / zoom** behavior on Plotly.js charts, plus the Plotly
configuration that hides the default controls. Every Plotly chart in a project
that adopts this should follow it so navigation feels identical everywhere.

Implement the drag gestures with a **single custom pointer-event handler**
(`attachGestures.js` in this folder is a ready-to-use vanilla-JS implementation).
Do **not** use Plotly's built-in drag modes (box-zoom, pan) or its built-in
y-axis scroll-zoom — the custom handler owns drag.

This is the **navigation-only** edition: it deliberately leaves out any
data-specific selection gestures (e.g. modifier+drag to include/exclude regions).
Modifier + drag is intentionally **unbound** here so an app can add its own
selection behavior later without changing the core handler.

Tested against Plotly.js 2.x. Framework-agnostic; ships a vanilla-JS reference.

---

## Using this in a project

1. Copy this folder (`chart-gestures/`) into the target repo (e.g. under `docs/`
   or `src/lib/`).
2. Wire the handler into each chart (vanilla example):
   ```js
   import { attachChartGestures, GESTURE_CONFIG, gestureLayout } from './chart-gestures/attachGestures.js';

   const gd = document.getElementById('chart');
   Plotly.newPlot(gd, data, gestureLayout(myLayout, /* uirevision */ 'chart-1'), GESTURE_CONFIG);
   const detach = attachChartGestures(gd, { yZoomAnchor: 'center' });
   // call detach() if you ever tear the chart down
   ```
   (For a classic non-module `<script>` build, delete the `export` keywords in
   `attachGestures.js` and the functions become globals.)
3. Add a line to the repo's agent instructions (`CLAUDE.md` / `AGENTS.md` /
   `.cursorrules` / `.github/copilot-instructions.md`):

   > All Plotly charts must follow `chart-gestures/plotly-chart-gestures.md` and
   > use `attachChartGestures` from `chart-gestures/attachGestures.js`. When you
   > create or edit any chart, read that file first and apply every rule. Do not
   > use Plotly's built-in drag modes (box-zoom, pan) or its built-in y-axis
   > scroll-zoom — the custom pointer handler owns drag.

4. Treat **Required gestures** and **Plotly configuration** as hard requirements,
   **Implementation requirements** as the checklist that makes it actually work,
   and verify with the **Definition of done** in a real browser.

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
- **Right-click drag** = pan Y **and** zoom X simultaneously (the mirror of the
  left-drag).
  - Vertical motion pans the Y axis (grab-and-drag: drag **down** moves the
    content down).
  - Horizontal motion zooms X multiplicatively about the X-range center: drag
    **right** = zoom **in**, drag **left** = zoom out (`factor = Math.exp(-dx / 200)`),
    mirroring the left-drag's "drag up = zoom in".
  - A **no-move right-click** must still open the chart's context menu (app or
    browser) — only a right-click that actually *drags* runs the gesture and
    suppresses the menu (see the context-menu gotcha below).
  - When the Y axis is externally locked (a "Y lock" toggle), right-drag only
    zooms X and skips the Y pan.
- **Mouse wheel / scroll** = zoom **X only** (Y stays fixed). This is provided by
  Plotly's built-in `scrollZoom` constrained to X by `yaxis.fixedrange:true` —
  not by the pointer handler.
- **Double-click** = disabled (no autoscale-reset).
- **Modifier + drag** (Shift / Ctrl / Cmd) = intentionally **unbound**. Reserve it
  for app-specific data interactions; the core handler does not consume it.

---

## Plotly configuration

This is what makes wheel = X-zoom and disables the built-in interactions. The
`GESTURE_CONFIG` constant and `gestureLayout()` helper in `attachGestures.js`
apply all of it for you.

- `layout.dragmode = false`
- `layout.yaxis.fixedrange = true`  ← makes Plotly's `scrollZoom` act on X only
  (the drag handler moves Y directly via `relayout`, which bypasses fixedrange)
- `config.displayModeBar = false`  ← hides the default Plotly toolbar
- `config.scrollZoom = true`
- `config.doubleClick = false`
- A stable `layout.uirevision` (constant per chart/dataset) so framework or data
  re-renders don't reset the user's pan/zoom.

---

## Implementation requirements / gotchas

Each of these fixed a real, reproducible bug. Skipping them produces subtle
breakage that looks fine at first. (`attachGestures.js` already does all of them.)

1. **Use Pointer Events + `setPointerCapture` on the stable chart container div**,
   not on `event.target`. Plotly re-renders and detaches inner SVG/WebGL nodes on
   every relayout you issue mid-drag; capturing the target releases capture after
   one frame. Capturing the container keeps every `pointermove`/`pointerup` flowing
   even when the cursor crosses Plotly's hover / scattergl layers (which otherwise
   hijack the events and "freeze" the pan/zoom).
2. Attach `pointerdown` in the **capture phase** and call `preventDefault()` +
   `stopPropagation()` (left-drag) so Plotly's own hover/selection handlers don't
   fight you. Listen for `pointermove`/`pointerup`/`pointercancel` **on the
   container div** (not `window`) — pointer capture redirects events to the
   captured element.
3. **Hit-test the plot area by geometry, not SVG ancestry.** Check the pointer
   against `_fullLayout.xaxis._offset/_length` and `_fullLayout.yaxis._offset/_length`.
   An ancestor check (e.g. testing for `.nsewdrag`) refuses drags that start on an
   annotation label, which renders in a layer above the drag layer.
4. **Date axes:** `_fullLayout.{x,y}axis.range` holds ISO date strings
   (`"YYYY-MM-DD HH:mm:ss.sss"`) on `type:'date'` axes and numbers otherwise.
   Coerce to numeric ms before any arithmetic (`Date.parse` for strings), or
   `range[1] - range[0]` yields `NaN` and the chart snaps to a 1970-epoch range.
5. **rAF-throttle** the `Plotly.relayout` calls during a drag — coalesce patches in
   a single `requestAnimationFrame`; flush the final patch on `pointerup`.
6. Call `Plotly.relayout(graphDiv, patch)` with the captured **element
   reference**, not the string graph id — robust to id drift across remounts.
7. Build the relayout patch as
   `{ 'xaxis.range': [x0, x1], 'yaxis.range': [y0, y1] }`. Offer a
   **"disable Y zoom"** mode that omits the `yaxis` key, for charts whose Y range
   is pinned by an external lock.
8. **Right-drag vs. the context menu.** The right button serves double duty: a
   *drag* runs the pan-Y/zoom-X gesture, but a plain *click* must still open the
   context menu. Don't `preventDefault()` the right `pointerdown` (that can swallow
   the `contextmenu` event). Instead track a `rightDragMoved` flag (set once the
   pointer moves past a few px) and add a **capture-phase `contextmenu` listener**
   on the container that calls `preventDefault()` + `stopPropagation()` **only when
   `rightDragMoved`** — then resets it. Capture + stopPropagation keeps the event
   from reaching a bubble-phase / framework-root menu trigger, so the menu never
   opens after a drag but always opens on a clean click.

---

## Definition of done

Verify in a real browser (not just unit tests / visual inspection):

- Plain (left) drag pans X and zooms Y; up = zoom in, down = zoom out.
- Right drag pans Y and zooms X; right = zoom in, left = zoom out, vertical pans Y.
- A no-move right-click still opens the context menu; a right-*drag* suppresses it.
- Wheel zooms X only; Y stays put.
- The default Plotly modebar is hidden; double-click does nothing.
- A drag that **starts on an annotation/label** still pans (geometry hit-test).
- Date-axis charts never jump to 1970 (numeric coercion).
- Chained drags keep working; pan/zoom **survives theme/data re-renders**
  (stable `uirevision`, listeners not torn down).
- No console errors; hover still works.
