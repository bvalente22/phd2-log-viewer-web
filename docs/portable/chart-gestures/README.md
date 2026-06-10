# chart-gestures — portable Plotly pan/zoom gestures

A self-contained, framework-free bundle for giving every Plotly.js chart the
same mouse navigation (and hiding Plotly's default controls). Drop the whole
`chart-gestures/` folder into any project.

**Navigation only** — left/right drag pan+zoom and wheel zoom. It deliberately
omits data-specific selection gestures (e.g. modifier+drag to include/exclude
data); modifier+drag is left unbound so each app can add its own.

## Contents

| File | What it is |
|------|------------|
| `plotly-chart-gestures.md` | The rules: required gestures, Plotly config, implementation gotchas, definition-of-done. Hand this to your coding agent. |
| `attachGestures.js` | Vanilla-JS reference implementation — `attachChartGestures(gd, opts)`, plus `GESTURE_CONFIG` and `gestureLayout()`. No dependencies. |
| `README.md` | This file. |

## Quick start (Plotly + vanilla JS)

```js
import { attachChartGestures, GESTURE_CONFIG, gestureLayout } from './chart-gestures/attachGestures.js';

const gd = document.getElementById('chart');

Plotly.newPlot(
  gd,
  data,
  gestureLayout(myLayout, 'my-chart'), // sets dragmode:false, yaxis.fixedrange, uirevision
  GESTURE_CONFIG,                       // hides modebar, scrollZoom on, doubleClick off
);

const detach = attachChartGestures(gd, {
  yZoomAnchor: 'center',   // or 'bottom' for amplitude/periodogram charts
  // disableYZoom: () => yLockOn,   // optional live Y-lock
  // onRangeChange: (axis, range) => {/* persist view */},
});

// when removing the chart:
detach();
```

### Gestures you get

- **Left-drag** → pan X + zoom Y (drag up = zoom in)
- **Right-drag** → pan Y + zoom X (drag right = zoom in); a no-move right-click
  still opens your/the browser's context menu
- **Wheel** → zoom X only
- **Double-click** → disabled; **default modebar** → hidden

### Options (`attachChartGestures(gd, options)`)

| Option | Default | Meaning |
|--------|---------|---------|
| `plotly` | `window.Plotly` | The Plotly object (pass it for module/bundler setups). |
| `yZoomAnchor` | `'center'` | `'center'` scales Y around the range midpoint; `'bottom'` keeps y0 fixed and scales only y1 (baseline-anchored charts). |
| `disableYZoom` | `false` | `true` (or a `() => boolean`) to leave Y untouched on drag. |
| `sensitivity` | `200` | Pixels of drag that halve/double a span. |
| `suppressContextMenuAfterDrag` | `true` | Swallow the menu after a right-*drag* only. |
| `onRangeChange(axis, [lo,hi])` | — | Called as ranges change (persist the view, etc.). |
| `onDragStateChange(active)` | — | `true` on drag start, `false` on end. |

Returns a `detach()` function that removes all listeners.

### Non-module (`<script>`) projects

`attachGestures.js` is an ES module. For a classic script tag either load it with
`<script type="module">`, or delete the `export` keywords and the functions
become globals (`attachChartGestures`, `GESTURE_CONFIG`, `gestureLayout`).

## Telling your coding agent to use it

Add to the target repo's `CLAUDE.md` (or `AGENTS.md` / `.cursorrules` /
`.github/copilot-instructions.md`):

> All Plotly charts must follow `chart-gestures/plotly-chart-gestures.md` and use
> `attachChartGestures` from `chart-gestures/attachGestures.js`. Read that file
> before creating or editing any chart and apply every rule. Do not use Plotly's
> built-in drag modes or built-in y-axis scroll-zoom — the custom pointer handler
> owns drag.
