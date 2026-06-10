/**
 * attachChartGestures — portable, framework-free pan/zoom gestures for Plotly.js.
 *
 * Navigation only (no data-selection): left-drag pans X + zooms Y, right-drag
 * pans Y + zooms X (the mirror), the mouse wheel zooms X (via Plotly's own
 * scrollZoom — see GESTURE_CONFIG / the axis setup in the spec), and Plotly's
 * built-in drag modes / double-click reset are turned off so this handler owns
 * all dragging.
 *
 * Tested against Plotly.js 2.x. No dependencies. Works in any vanilla project;
 * for a classic <script> (non-module) build, delete the two `export` keywords
 * and the functions become globals.
 *
 * Usage:
 *   import { attachChartGestures, GESTURE_CONFIG } from './attachGestures.js';
 *   const gd = document.getElementById('chart');
 *   Plotly.newPlot(gd, data, gestureLayout(layout), GESTURE_CONFIG);
 *   const detach = attachChartGestures(gd, { yZoomAnchor: 'center' });
 *   // later: detach();
 *
 * See plotly-chart-gestures.md for the full rules, required Plotly config, and
 * the gotchas each line of this file exists to satisfy.
 */

/**
 * Plotly `config` that makes the wheel zoom X-only and disables the built-in
 * interactions this handler replaces. Pass as the 4th arg to Plotly.newPlot /
 * Plotly.react. (Pair with the axis setup in `gestureLayout` below.)
 */
export const GESTURE_CONFIG = {
  displayModeBar: false, // hide the default Plotly toolbar (zoom/pan/lasso/etc.)
  scrollZoom: true,      // wheel zoom — constrained to X by yaxis.fixedrange
  doubleClick: false,    // no autoscale-reset on double-click
};

/**
 * Merge the axis/layout flags the gestures rely on into your layout object:
 *   - dragmode:false           → Plotly never starts its own box-zoom/pan drag
 *   - yaxis.fixedrange:true    → Plotly's scrollZoom acts on X only; our drag
 *                                handler moves Y directly via relayout, which
 *                                bypasses fixedrange
 *   - uirevision (if provided) → user pan/zoom survives data/theme re-renders
 * Returns a new object; does not mutate the input.
 */
export function gestureLayout(layout = {}, uirevision) {
  return {
    ...layout,
    dragmode: false,
    xaxis: { ...(layout.xaxis || {}), fixedrange: false },
    yaxis: { ...(layout.yaxis || {}), fixedrange: true },
    ...(uirevision !== undefined ? { uirevision } : {}),
  };
}

// --- internal helpers -------------------------------------------------------

/**
 * Coerce a Plotly axis range endpoint to a number (ms for date axes).
 * `_fullLayout.{x,y}axis.range` holds ISO date strings
 * ("YYYY-MM-DD HH:mm:ss.sss") on type:'date' axes and numbers otherwise.
 * Without this, `range[1] - range[0]` is NaN and the chart snaps to 1970.
 */
function toNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : NaN;
  }
  return NaN;
}
function numericRange(r) {
  if (!r || r.length < 2) return [NaN, NaN];
  return [toNum(r[0]), toNum(r[1])];
}

/**
 * @param {HTMLElement} gd  The Plotly graph div (the element handed to
 *                          Plotly.newPlot; Plotly sets `_fullLayout` on it).
 * @param {object} [options]
 * @param {object}  [options.plotly]       Plotly object (defaults to window.Plotly).
 * @param {'center'|'bottom'} [options.yZoomAnchor='center']
 *        Y-zoom anchor for left-drag. 'center' scales around the current
 *        Y-range midpoint; 'bottom' keeps y0 fixed and scales only y1 (use for
 *        charts whose lower bound is a semantic baseline, e.g. amplitude ≥ 0).
 * @param {boolean|(()=>boolean)} [options.disableYZoom=false]
 *        When true, drags leave Y alone (left-drag only pans X; right-drag only
 *        zooms X). Pass a function to flip it live (e.g. a "Y lock" toggle).
 * @param {number} [options.sensitivity=200]
 *        Pixels of drag that halve/double a span. Larger = less sensitive.
 * @param {boolean} [options.suppressContextMenuAfterDrag=true]
 *        Swallow the contextmenu event after a right-*drag* (a no-move
 *        right-click still fires it, so an app/browser menu can open).
 * @param {(axis:'x'|'y', range:[number,number])=>void} [options.onRangeChange]
 * @param {(active:boolean)=>void} [options.onDragStateChange]
 * @returns {() => void} detach function — removes listeners and the rAF.
 */
export function attachChartGestures(gd, options = {}) {
  const Plotly = options.plotly || (typeof window !== 'undefined' ? window.Plotly : undefined);
  if (!gd || !Plotly) {
    throw new Error('attachChartGestures: need a Plotly graph div and a Plotly object.');
  }
  const SENS = options.sensitivity ?? 200;
  const suppressMenu = options.suppressContextMenuAfterDrag ?? true;
  const anchorOf = () => options.yZoomAnchor ?? 'center';
  const disableY = () =>
    typeof options.disableYZoom === 'function' ? !!options.disableYZoom() : !!options.disableYZoom;
  const onRange = options.onRangeChange;
  const onDragState = options.onDragStateChange;

  gd.style.position = gd.style.position || 'relative';

  // rAF-throttle relayouts: coalesce patches across a frame, flush on pointerup.
  let rafId = null;
  let pendingPatch = null;
  const queueRelayout = (patch) => {
    pendingPatch = pendingPatch ? { ...pendingPatch, ...patch } : { ...patch };
    if (rafId == null) {
      rafId = requestAnimationFrame(() => {
        if (pendingPatch) Plotly.relayout(gd, pendingPatch); // element ref, not id
        pendingPatch = null;
        rafId = null;
      });
    }
  };

  // Hit-test the plot area by geometry (not SVG ancestry) so a drag that starts
  // on an annotation/label still counts as "inside the plot."
  const isInPlotArea = (e) => {
    const fl = gd._fullLayout;
    const xa = fl && fl.xaxis, ya = fl && fl.yaxis;
    if (!xa || !ya) return false;
    const rect = gd.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return (
      px >= xa._offset && px <= xa._offset + xa._length &&
      py >= ya._offset && py <= ya._offset + ya._length
    );
  };

  // 'PAN_ZOOM' = left-drag (pan X + zoom Y). 'PAN_Y_ZOOM_X' = right-drag (the
  // mirror: pan Y + zoom X).
  let kind = null;
  let activePointerId = null;
  let startClientX = 0, startClientY = 0;
  let startXRange = [0, 0], startYRange = [0, 0];
  let rightDragMoved = false; // true once a right-drag passes the click threshold

  const onDown = (e) => {
    if (e.button !== 0 && e.button !== 2) return; // left or right only
    if (!isInPlotArea(e)) return;
    const fl = gd._fullLayout;
    if (!fl || !fl.xaxis || !fl.yaxis) return;

    // Capture on the STABLE container, never e.target: Plotly re-renders and
    // detaches inner SVG/WebGL nodes on every mid-drag relayout, which would
    // release a target-bound capture after one frame.
    try { gd.setPointerCapture(e.pointerId); } catch { /* best-effort */ }
    activePointerId = e.pointerId;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startXRange = numericRange(fl.xaxis.range);
    startYRange = numericRange(fl.yaxis.range);

    if (e.button === 2) {
      // Right drag = pan Y + zoom X. Do NOT preventDefault — that can swallow
      // the contextmenu event we still want for a no-move right-click.
      kind = 'PAN_Y_ZOOM_X';
      rightDragMoved = false;
      onDragState && onDragState(true);
      e.stopPropagation();
      return;
    }

    kind = 'PAN_ZOOM';
    onDragState && onDragState(true);
    // Stop Plotly's own mousedown handlers (hover, point selection) fighting us.
    e.preventDefault();
    e.stopPropagation();
  };

  const onMove = (e) => {
    if (!kind) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    const fl = gd._fullLayout;
    const xa = fl && fl.xaxis;
    if (!xa) return;

    if (kind === 'PAN_ZOOM') {
      const dx = e.clientX - startClientX;
      const dy = e.clientY - startClientY;
      const xSpan = startXRange[1] - startXRange[0];
      const dxData = (dx / xa._length) * xSpan;
      const newX = [startXRange[0] - dxData, startXRange[1] - dxData];
      const patch = { 'xaxis.range': newX };
      onRange && onRange('x', newX);

      if (!disableY()) {
        const factor = Math.exp(dy / SENS); // drag up (dy<0) → factor<1 → zoom in
        let newY;
        if (anchorOf() === 'bottom') {
          newY = [startYRange[0], startYRange[0] + (startYRange[1] - startYRange[0]) * factor];
        } else {
          const c = (startYRange[0] + startYRange[1]) / 2;
          const half = ((startYRange[1] - startYRange[0]) * factor) / 2;
          newY = [c - half, c + half];
        }
        patch['yaxis.range'] = newY;
        onRange && onRange('y', newY);
      }
      queueRelayout(patch);
      return;
    }

    // PAN_Y_ZOOM_X (right-drag, mirror gesture)
    const ya = fl && fl.yaxis;
    if (!ya) return;
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) rightDragMoved = true;

    const xc = (startXRange[0] + startXRange[1]) / 2;
    const xSpan = (startXRange[1] - startXRange[0]) * Math.exp(-dx / SENS); // right = zoom in
    const newX = [xc - xSpan / 2, xc + xSpan / 2];
    const patch = { 'xaxis.range': newX };
    onRange && onRange('x', newX);

    if (!disableY()) {
      const ySpan = startYRange[1] - startYRange[0];
      const dyData = (dy / ya._length) * ySpan; // grab-and-drag: down moves content down
      const newY = [startYRange[0] + dyData, startYRange[1] + dyData];
      patch['yaxis.range'] = newY;
      onRange && onRange('y', newY);
    }
    queueRelayout(patch);
  };

  const releaseCapture = () => {
    if (activePointerId !== null) {
      try { gd.releasePointerCapture(activePointerId); } catch { /* ignore */ }
    }
    activePointerId = null;
  };

  const endDrag = () => {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    if (pendingPatch) { Plotly.relayout(gd, pendingPatch); pendingPatch = null; }
    releaseCapture();
    kind = null;
    onDragState && onDragState(false);
  };

  const onUp = (e) => {
    if (!kind) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    endDrag();
  };

  const onCancel = (e) => {
    if (!kind) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    pendingPatch = null;
    releaseCapture();
    kind = null;
    onDragState && onDragState(false);
  };

  // Suppress the menu only after a right-*drag*; a clean right-click falls
  // through so an app/browser context menu can still open. Capture phase +
  // stopPropagation keeps it from a bubble-phase / framework-root menu trigger.
  const onContextMenu = (e) => {
    if (suppressMenu && rightDragMoved) {
      e.preventDefault();
      e.stopPropagation();
      rightDragMoved = false;
    }
  };

  // Capture phase so we beat Plotly's bubble-phase handlers. move/up/cancel on
  // the div (not window): pointer capture redirects events to the captured el.
  gd.addEventListener('pointerdown', onDown, true);
  gd.addEventListener('pointermove', onMove, true);
  gd.addEventListener('pointerup', onUp, true);
  gd.addEventListener('pointercancel', onCancel, true);
  gd.addEventListener('contextmenu', onContextMenu, true);

  return function detach() {
    gd.removeEventListener('pointerdown', onDown, true);
    gd.removeEventListener('pointermove', onMove, true);
    gd.removeEventListener('pointerup', onUp, true);
    gd.removeEventListener('pointercancel', onCancel, true);
    gd.removeEventListener('contextmenu', onContextMenu, true);
    if (rafId != null) cancelAnimationFrame(rafId);
  };
}
