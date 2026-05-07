import { useEffect, useRef } from 'react';
// @ts-expect-error -- no types for the dist bundle; we only call relayout.
import Plotly from 'plotly.js/dist/plotly';

interface PlotDiv extends HTMLDivElement {
  _fullLayout?: {
    xaxis?: { _offset: number; _length: number; range: [number, number] };
    yaxis?: { _offset: number; _length: number; range: [number, number] };
  };
}

const INCLUDE_FILL = 'rgba(34, 197, 94, 0.18)';
const INCLUDE_BORDER = 'rgba(34, 197, 94, 0.7)';
const EXCLUDE_FILL = 'rgba(251, 146, 60, 0.18)';
const EXCLUDE_BORDER = 'rgba(251, 146, 60, 0.7)';

export interface ChartGestureCallbacks {
  /** Called when the user shift-drags a horizontal range. Frames passed are mount-frame numbers. */
  onIncludeRange?: (frameLo: number, frameHi: number) => void;
  /** Called when the user ctrl/cmd-drags a horizontal range. */
  onExcludeRange?: (frameLo: number, frameHi: number) => void;
  /** Called whenever the X or Y range changes (drag-pan, Y-zoom). */
  onRangeChange?: (axis: 'x' | 'y', range: [number, number]) => void;
  /** Provides frames + dt-mapping for the include/exclude callbacks. */
  rangeContext?: () => { frames: number[]; dts: number[] } | null;
  /**
   * Fires `true` on pointerdown that produces a drag (any kind), `false`
   * on pointerup / pointercancel after the drag's final relayout has been
   * dispatched. Lets parents skip per-frame work that doesn't have to run
   * mid-drag (e.g. SVG annotation re-layout) and run a single settle pass
   * on release. Always paired (every `true` is followed by exactly one
   * `false`).
   */
  onDragStateChange?: (active: boolean) => void;
}

export interface ChartGestureOptions {
  enableModifierSelect?: boolean; // default true
  hideRangeSliderDuringDrag?: boolean; // default false
  /**
   * Anchor for the drag-driven Y zoom.
   * 'center' (default) — symmetrically scale around the current y-range
   *   midpoint. Matches the desktop's behavior on the main chart, where
   *   y is signed and centering on zero by accident is the natural ask.
   * 'bottom' — keep y0 fixed at startYRange[0] (typically 0) and only
   *   scale y1. Use for charts whose lower bound is semantically the
   *   baseline (e.g. periodogram amplitude — always >= 0).
   */
  yZoomAnchor?: 'center' | 'bottom';
  /**
   * Skip the Y-axis update entirely on drag. Drag still pans X; the Y
   * range is left alone. Use when the chart pins its Y range from an
   * external lock (e.g. AnalysisModal's "Y locked" toggle).
   */
  disableYZoom?: boolean;
}

/**
 * Drag-driven chart gestures shared between the main GuideGraph and the
 * Analysis modal's two charts:
 *   - Plain drag = X pan + continuous Y zoom anchored on the cursor's data Y.
 *   - Shift+drag = horizontal include selection (callback only).
 *   - Ctrl/Cmd+drag = horizontal exclude selection (callback only).
 *   - Wheel zoom is provided by Plotly's built-in scrollZoom; not handled here.
 *
 * rAF-throttles relayouts and (optionally) hides an attached rangeslider
 * during the drag for performance.
 */
export function useChartGestures(
  plotId: string,
  callbacks: ChartGestureCallbacks,
  opts: ChartGestureOptions = {},
) {
  const enableModifierSelect = opts.enableModifierSelect ?? true;
  const hideSlider = opts.hideRangeSliderDuringDrag ?? false;
  // yZoomAnchor and disableYZoom can flip while a drag is mid-flight
  // (e.g. user clicks the Y-lock toggle). Routing them through a ref
  // — same pattern as `cbRef` for callbacks — lets the listener pick
  // up the new value on the next pointermove without re-installing
  // handlers (which would clobber `kind` and break the active drag).
  const optsRef = useRef({
    yZoomAnchor: opts.yZoomAnchor ?? 'center',
    disableYZoom: opts.disableYZoom ?? false,
  });
  optsRef.current = {
    yZoomAnchor: opts.yZoomAnchor ?? 'center',
    disableYZoom: opts.disableYZoom ?? false,
  };

  // Keep callbacks in a ref so the effect below isn't torn down and rebuilt
  // on every parent render (callbacks is typically a fresh object literal in
  // JSX). If the effect re-ran mid-drag, the listener closure would be
  // replaced — and the new closure starts with kind=null, which made
  // pointermove silently early-return after a successful pointerdown,
  // causing the drag to "stop after a short distance". This ref keeps a
  // single, stable listener installation across renders while still
  // letting callers update their callback bodies freely.
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    const div = document.getElementById(plotId) as PlotDiv | null;
    if (!div) return;
    div.style.position = 'relative';

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:absolute',
      'top:0',
      'bottom:0',
      'pointer-events:none',
      'display:none',
      'z-index:5',
      'border-style:solid',
      'border-width:1px',
    ].join(';');
    div.appendChild(overlay);

    // Geometry-based hit-test instead of checking the click target's SVG
    // ancestor. Annotation labels (when the Events toggle is on) sit in a
    // higher SVG layer than .nsewdrag, so an ancestor check would refuse
    // drags that started on a label even though the cursor is inside the
    // plot area.
    const isInPlotArea = (e: MouseEvent): boolean => {
      const xa = div._fullLayout?.xaxis;
      const ya = div._fullLayout?.yaxis;
      if (!xa || !ya) return false;
      const rect = div.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      return (
        px >= xa._offset && px <= xa._offset + xa._length &&
        py >= ya._offset && py <= ya._offset + ya._length
      );
    };

    let rafId: number | null = null;
    let pendingPatch: Record<string, [number, number]> | null = null;
    const queueRelayout = (patch: Record<string, [number, number]>) => {
      pendingPatch = pendingPatch ? { ...pendingPatch, ...patch } : { ...patch };
      if (rafId == null) {
        rafId = requestAnimationFrame(() => {
          if (pendingPatch) void Plotly.relayout(div, pendingPatch);
          pendingPatch = null;
          rafId = null;
        });
      }
    };

    type DragKind = 'PAN_ZOOM' | 'X_INCLUDE' | 'X_EXCLUDE' | null;
    let kind: DragKind = null;
    let activePointerId: number | null = null;
    let captureTarget: Element | null = null;
    let startClientX = 0;
    let startClientY = 0;
    let startYRange: [number, number] = [0, 0];
    let startXRange: [number, number] = [0, 0];
    let xStartFrac = 0;
    let sliderHidden = false;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!isInPlotArea(e)) return;
      const xa = div._fullLayout?.xaxis;
      const ya = div._fullLayout?.yaxis;
      if (!xa || !ya) return;
      const rect = div.getBoundingClientRect();

      // setPointerCapture on the chart container guarantees every
      // subsequent pointermove/pointerup is delivered here regardless of
      // what's under the cursor — including Plotly's hover/scattergl
      // layers, which would otherwise hijack mouse events partway through
      // a drag and "freeze" our pan/zoom.
      //
      // Important: capture on `div` (the stable plot container), NOT on
      // e.target. The target may be an SVG path or canvas inside Plotly
      // that gets re-rendered (and detached from the DOM) on every
      // relayout we issue mid-drag — the browser implicitly releases
      // capture when the captured element leaves the DOM, which would
      // make this useless after the first frame.
      try { div.setPointerCapture(e.pointerId); }
      catch { /* ignore — capture is best-effort */ }
      captureTarget = div;
      activePointerId = e.pointerId;

      if (enableModifierSelect && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        kind = e.shiftKey ? 'X_INCLUDE' : 'X_EXCLUDE';
        const px = e.clientX - rect.left - xa._offset;
        xStartFrac = Math.min(1, Math.max(0, px / xa._length));
        const isInclude = kind === 'X_INCLUDE';
        overlay.style.display = 'block';
        overlay.style.left = (xa._offset + xStartFrac * xa._length) + 'px';
        overlay.style.width = '0px';
        overlay.style.background = isInclude ? INCLUDE_FILL : EXCLUDE_FILL;
        overlay.style.borderColor = isInclude ? INCLUDE_BORDER : EXCLUDE_BORDER;
        cbRef.current.onDragStateChange?.(true);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      kind = 'PAN_ZOOM';
      // Y zoom uses multiplicative scaling around the *center* of the
      // current Y range (not data Y=0). Mirrors LogViewFrame.cpp:1192-1199:
      // the desktop just does `vscale *= 1.05` per upward move event,
      // implicitly centered (its y range is symmetric around 0). Anchoring
      // on the chart center makes the zoom feel identical regardless of
      // where on the chart the user clicked or whether Y has been panned.
      const [y0, y1] = ya.range;
      startClientX = e.clientX;
      startClientY = e.clientY;
      startYRange = [y0, y1];
      startXRange = [...xa.range] as [number, number];
      if (hideSlider) {
        void Plotly.relayout(div, { 'xaxis.rangeslider.visible': false });
        sliderHidden = true;
      }
      cbRef.current.onDragStateChange?.(true);
      // Stop propagation so Plotly's own mousedown handlers (hover, point
      // selection on scattergl traces) don't fight our drag.
      e.preventDefault();
      e.stopPropagation();
    };

    const onMove = (e: PointerEvent) => {
      if (!kind) return;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      const xa = div._fullLayout?.xaxis;
      if (!xa) return;
      if (kind === 'PAN_ZOOM') {
        // Continuous form of the desktop's per-event ×1.05 scaling. Drag
        // up (dy<0) → zoom in (smaller span), drag down → zoom out. The
        // /200 divisor controls sensitivity; a 200 px drag doubles/halves.
        const dy = e.clientY - startClientY;
        const factor = Math.exp(dy / 200);
        const dx = e.clientX - startClientX;
        const xSpan = startXRange[1] - startXRange[0];
        const dxData = (dx / xa._length) * xSpan;
        const newX0 = startXRange[0] - dxData;
        const newX1 = startXRange[1] - dxData;
        const { yZoomAnchor: anchor, disableYZoom } = optsRef.current;
        const patch: Record<string, [number, number]> = {
          'xaxis.range': [newX0, newX1],
        };
        if (!disableYZoom) {
          let newY0: number;
          let newY1: number;
          if (anchor === 'bottom') {
            // Bottom-anchored zoom keeps y0 at its starting value
            // (typically 0 — the periodogram baseline) and only the top
            // moves. Drag up → factor<1 → newY1 shrinks → zoom in.
            newY0 = startYRange[0];
            newY1 = startYRange[0] + (startYRange[1] - startYRange[0]) * factor;
          } else {
            const oldYSpan = startYRange[1] - startYRange[0];
            const newYSpan = oldYSpan * factor;
            const yCenter = (startYRange[0] + startYRange[1]) / 2;
            newY0 = yCenter - newYSpan / 2;
            newY1 = yCenter + newYSpan / 2;
          }
          patch['yaxis.range'] = [newY0, newY1];
          cbRef.current.onRangeChange?.('y', [newY0, newY1]);
        }
        queueRelayout(patch);
        cbRef.current.onRangeChange?.('x', [newX0, newX1]);
        return;
      }
      const rect = div.getBoundingClientRect();
      const curPx = e.clientX - rect.left - xa._offset;
      const curFrac = Math.min(1, Math.max(0, curPx / xa._length));
      const a = Math.min(xStartFrac, curFrac);
      const b = Math.max(xStartFrac, curFrac);
      overlay.style.left = (xa._offset + a * xa._length) + 'px';
      overlay.style.width = ((b - a) * xa._length) + 'px';
    };

    const releaseCapture = () => {
      if (captureTarget && activePointerId !== null) {
        try {
          (captureTarget as Element & { releasePointerCapture?: (id: number) => void })
            .releasePointerCapture?.(activePointerId);
        } catch { /* ignore */ }
      }
      captureTarget = null;
      activePointerId = null;
    };

    const onUp = (e: PointerEvent) => {
      if (!kind) return;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      const xa = div._fullLayout?.xaxis;

      if (kind !== 'PAN_ZOOM' && xa && cbRef.current.rangeContext) {
        overlay.style.display = 'none';
        const rect = div.getBoundingClientRect();
        const endPx = e.clientX - rect.left - xa._offset;
        const endFrac = Math.min(1, Math.max(0, endPx / xa._length));
        const a = Math.min(xStartFrac, endFrac);
        const b = Math.max(xStartFrac, endFrac);
        if (b - a >= 0.005) {
          const [x0, x1] = xa.range;
          const tA = x0 + a * (x1 - x0);
          const tB = x0 + b * (x1 - x0);
          const ctx = cbRef.current.rangeContext();
          if (ctx) {
            let firstFrame = -1, lastFrame = -1;
            for (let i = 0; i < ctx.dts.length; i++) {
              if (ctx.dts[i] >= tA && ctx.dts[i] <= tB) {
                if (firstFrame < 0) firstFrame = ctx.frames[i];
                lastFrame = ctx.frames[i];
              }
            }
            if (firstFrame >= 0) {
              if (kind === 'X_INCLUDE') cbRef.current.onIncludeRange?.(firstFrame, lastFrame);
              else cbRef.current.onExcludeRange?.(firstFrame, lastFrame);
            }
          }
        }
      }

      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const finalPatch: Record<string, unknown> = pendingPatch ?? {};
      pendingPatch = null;
      if (sliderHidden) {
        finalPatch['xaxis.rangeslider.visible'] = true;
        sliderHidden = false;
      }
      if (Object.keys(finalPatch).length > 0) {
        void Plotly.relayout(div, finalPatch);
      }

      releaseCapture();
      kind = null;
      // Fire AFTER kind is cleared so parents can run their settle pass
      // (e.g. annotation re-layout) without the still-open mid-drag gate
      // blocking it. The final Plotly.relayout above ran while the gate
      // was still closed in the parent — that's fine, the parent picks
      // up the new ranges via its own onRelayout listener.
      cbRef.current.onDragStateChange?.(false);
    };

    const onCancel = (e: PointerEvent) => {
      if (!kind) return;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      overlay.style.display = 'none';
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
      pendingPatch = null;
      if (sliderHidden) {
        void Plotly.relayout(div, { 'xaxis.rangeslider.visible': true });
        sliderHidden = false;
      }
      releaseCapture();
      kind = null;
      cbRef.current.onDragStateChange?.(false);
    };

    // Capture-phase pointerdown so we beat any Plotly handlers attached on
    // bubble. Move/up/cancel listen on `div` rather than window because
    // setPointerCapture redirects all events to the captured element (which
    // is inside the div), so a window-level listener wouldn't see them.
    div.addEventListener('pointerdown', onDown, true);
    div.addEventListener('pointermove', onMove, true);
    div.addEventListener('pointerup', onUp, true);
    div.addEventListener('pointercancel', onCancel, true);
    return () => {
      div.removeEventListener('pointerdown', onDown, true);
      div.removeEventListener('pointermove', onMove, true);
      div.removeEventListener('pointerup', onUp, true);
      div.removeEventListener('pointercancel', onCancel, true);
      overlay.remove();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
    // Intentionally exclude `callbacks` from deps — they're routed through
    // cbRef so the listener install survives parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotId, enableModifierSelect, hideSlider]);
}
